// biome-ignore-all lint/nursery/noExcessiveLinesPerFile: ChatSession owns the full per-thread turn lifecycle (provider build/rebuild, send routing, permission-mode resolution, abort/cancel drain). Splitting fragments the lifecycle and forces every reader to follow imports across files; keep the state machine in one window.
import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import type { AcpxMcpServerConfig, AcpxProvider } from 'acpx-ai-provider'
import { type ModelMessage, streamText } from 'ai'
import { eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import type { Employee } from '../../db/schema/employees.sql.js'
import { type Thread, threads } from '../../db/schema/threads.sql.js'
import type { DB } from '../../db/types.js'
import {
  DEFAULT_PERMISSION_MODE,
  type PermissionMode,
} from '../../shared/permission.js'
import { type AcpxProviderFactory, buildAcpxProvider } from './acpx-provider.js'
import { extractErrorDetails } from './error-details.js'
import { EventSink } from './event-sink.js'
import { cancelAllPendingPermissions } from './permission-callback.js'
import { resolvePermissionMode } from './permission-mode-resolver.js'
import { applyConfigDelta, bootstrapNewProvider } from './provider-resolver.js'
import { rebuildMessagesFromEvents } from './replay.js'
import { StreamTranslator } from './stream-part.js'
import { maybeAutoTitle } from './title-auto.js'
import {
  type ChatTuple,
  providerKeyEqual,
  tupleKey,
  tuplesEqual,
} from './tuple.js'
import { sumModelMessageChars } from './turn-input-chars.js'

interface Init {
  db: DB
  employee: Employee
  thread: Thread
  /** Effective tuple — thread overrides merged with employee defaults. */
  tuple: ChatTuple
  mcpServers: AcpxMcpServerConfig[]
}

interface CreateDeps {
  providerFactory?: AcpxProviderFactory
}

const noop = () => undefined

// One ChatSession per thread. Owns a single AcpxProvider that's
// replaced (not cached) on provider-key change — when the user
// switches agent or workspace, the old provider is disposed and a
// fresh one is built. Pure model/effort changes stay on the same
// provider and apply via in-place setConfigOption RPCs.
export class ChatSession {
  private readonly sink: EventSink
  private provider: AcpxProvider
  private activeAbort: AbortController | null = null
  private activeTuple: ChatTuple
  /** Tracks whether bootstrapNewProvider has run for the current
   *  provider instance — flips to true after the first turn lands and
   *  resets when the provider is rebuilt on a tuple handoff. */
  private providerBootstrapped = false
  /** Resolved at construction time, mutated by send() at the start of
   *  each turn (picks up DB or settings changes), and read fresh by
   *  the onPermissionRequest callback via the getter passed to
   *  buildAcpxProvider. */
  private activePermissionMode: PermissionMode = DEFAULT_PERMISSION_MODE
  /** The current turn's requestId, set in send() and cleared on end
   *  / error / cancel. The permission callback reads it via a getter
   *  so emitted permission.request payloads can be grouped with the
   *  turn that produced them. */
  private activeTurnRequestId: string | null = null

  constructor(
    private readonly init: Init,
    private readonly deps: CreateDeps = {},
  ) {
    this.sink = new EventSink(init.db, init.thread.id)
    this.activeTuple = init.tuple
    // Spawn ENOENTs reference the binary path when the *cwd* is missing —
    // ensure the cwd exists before anything else does.
    this.ensureCwd(init.tuple.workspacePath)
    // Seed from the thread row's stored mode. resolvePermissionMode is
    // async (it reads settings as a fallback), but the synchronous
    // constructor path can use the column value directly when present
    // and otherwise fall back to the default. The first send() refreshes
    // from the proper resolver path before any callback fires.
    if (init.thread.permissionMode) {
      this.activePermissionMode = init.thread.permissionMode
    }
    this.provider = this.buildProvider(init.tuple)
  }

  private ensureCwd(workspacePath: string | null): void {
    const cwd = workspacePath ?? homedir()
    try {
      mkdirSync(cwd, { recursive: true })
    } catch {
      // mkdir failures (permissions, race) fall through to acpx's spawn
      // which will surface a clearer error.
    }
  }

  private buildProvider(tuple: ChatTuple): AcpxProvider {
    return buildAcpxProvider({
      tuple,
      thread: this.init.thread,
      mcpServers: this.init.mcpServers,
      providerFactory: this.deps.providerFactory,
      // Per-tuple sessionKey so each (agent, model, cwd, effort)
      // combination gets its own on-disk acpx record. Coming back
      // to a prior tuple later lets that agent's session memory
      // resume natively (modulo cross-agent: we still ship the
      // transcript via messages on every rebuild).
      sessionKeyOverride: tupleKey(tuple),
      // Permission policy is read fresh on every callback invocation,
      // so picker changes that landed between turns take effect on
      // the next gate without rebuilding the provider here.
      getPermissionMode: () => this.activePermissionMode,
      writeProtocolEvent: async (event) => {
        await this.sink.emit(event)
      },
      getActiveTurnRequestId: () => this.activeTurnRequestId,
    })
  }

  /** Updates the cached permission mode in response to a PATCH on
   *  the thread row. Idempotent; cheap. The next callback invocation
   *  reads through this. Safe to call mid-turn (the picker is
   *  disabled during streaming anyway). */
  setPermissionMode(mode: PermissionMode): void {
    this.activePermissionMode = mode
  }

  // Sends a user message, streams an agent reply. Routes between
  // four paths based on how the tuple changed since the previous turn:
  //
  //   A. Provider-key change (agentKind or workspacePath differs):
  //      dispose the live provider, build a fresh one, ship the full
  //      transcript via streamText({ messages }) so the new agent has
  //      complete context.
  //
  //   B. First send to a freshly-built provider that hasn't been
  //      bootstrapped yet (covers the just-constructed ChatSession
  //      case). Runs bootstrapNewProvider, then ships a single user
  //      message — the workspace-resident instruction file
  //      (CLAUDE.md / AGENTS.md / GEMINI.md) is the agent's
  //      bootstrap context; acpx's session/load handles fresh-vs-
  //      resume transparently.
  //
  //   C. Config-only change (model or effort differs but provider key
  //      is the same): apply setConfigOption deltas in place, send
  //      just the new user message. The agent's native session memory
  //      carries prior turns.
  //
  //   D. Same tuple as last turn: pure continuation, single message
  //      on the wire.
  async send(
    text: string,
    tuple: ChatTuple,
  ): Promise<{ requestId: string; aggregateText: string }> {
    const requestId = nanoid()
    this.activeTurnRequestId = requestId

    // Re-resolve permission mode at turn start so DB / settings
    // changes that landed between turns take effect immediately on
    // the next callback invocation. The synchronous constructor seed
    // only used the column value; the resolver also reads through to
    // the settings KV when the column is null.
    const [freshThread] = await this.init.db
      .select()
      .from(threads)
      .where(eq(threads.id, this.init.thread.id))
      .limit(1)
    if (freshThread) {
      this.activePermissionMode = await resolvePermissionMode(
        this.init.db,
        freshThread,
      )
    }

    await this.init.db
      .update(threads)
      .set({ status: 'streaming', updatedAt: new Date() })
      .where(eq(threads.id, this.init.thread.id))

    await this.sink.emit({
      type: 'turn.start',
      payload: {
        requestId,
        userMessage: text,
        agentKind: tuple.agentKind,
        modelId: tuple.modelId,
      },
    })

    const translator = new StreamTranslator(requestId)
    this.activeAbort = new AbortController()

    try {
      const messages = await this.routeTuple(tuple, text, requestId)
      this.activeTuple = tuple

      // Anchor the EmployeeBusy indicator's input-token cell as early
      // as possible: emitted between routeTuple and streamText so the
      // renderer gets the value within ~10-50ms of turn.start. The
      // chars/4 conversion happens on the renderer side; we just ship
      // the raw char count.
      await this.sink.emit({
        type: 'meta.turn-input',
        payload: {
          requestId,
          approxInputChars: sumModelMessageChars(messages),
        },
      })

      const result = streamText({
        model: this.provider.languageModel(),
        messages,
        abortSignal: this.activeAbort.signal,
      })
      for await (const part of result.fullStream) {
        for (const event of translator.translate(part)) {
          await this.sink.emit(event)
        }
      }
      const finishReason = (await result.finishReason) ?? 'stop'
      const usage = await result.usage
      await this.sink.emit({
        type: 'turn.end',
        payload: {
          requestId,
          finishReason,
          text: translator.aggregate,
          usage: {
            inputTokens: usage?.inputTokens,
            outputTokens: usage?.outputTokens,
          },
        },
      })

      await this.init.db
        .update(threads)
        .set({ status: 'idle', updatedAt: new Date() })
        .where(eq(threads.id, this.init.thread.id))

      // Server-side title backfill. If the agent didn't call
      // `browserclaw/set_thread_title` (model compliance varies, and
      // resumed acpx sessions skip re-reading AGENTS.md), derive a
      // title from this turn's user message. No-op once the title is
      // non-default — so the agent's call wins when it happens.
      await maybeAutoTitle(this.init.db, this.init.thread.id, text)
    } catch (err) {
      const details = extractErrorDetails(err)
      const reason: 'user-interrupt' | 'error' = this.activeAbort?.signal
        .aborted
        ? 'user-interrupt'
        : 'error'
      if (reason === 'error') {
        await this.sink.emit({
          type: 'error',
          payload: {
            requestId,
            code: details.code,
            message: details.message,
            retryable: details.retryable,
            details: details.details,
          },
        })
      } else {
        await this.sink.emit({
          type: 'turn.cancel',
          payload: { requestId, reason },
        })
      }
      await this.init.db
        .update(threads)
        .set({ status: 'idle', updatedAt: new Date() })
        .where(eq(threads.id, this.init.thread.id))
      throw err
    } finally {
      this.activeAbort = null
      this.activeTurnRequestId = null
    }

    return {
      requestId,
      aggregateText: translator.aggregate,
    }
  }

  /** Picks one of the four send paths described above and returns the
   *  `messages: ModelMessage[]` array to feed `streamText`. Side effect:
   *  may dispose + rebuild `this.provider` and run bootstrap or config-
   *  delta RPCs on it. */
  private async routeTuple(
    tuple: ChatTuple,
    text: string,
    requestId: string,
  ): Promise<ModelMessage[]> {
    const providerKept = providerKeyEqual(tuple, this.activeTuple)
    const sameTuple = providerKept && tuplesEqual(tuple, this.activeTuple)

    if (!providerKept) {
      // Path A: dispose + rebuild + full replay.
      await this.provider.close().catch(noop)
      this.ensureCwd(tuple.workspacePath)
      this.provider = this.buildProvider(tuple)
      this.providerBootstrapped = false
      await bootstrapNewProvider(this.provider, tuple)
      this.providerBootstrapped = true
      const past = await rebuildMessagesFromEvents(
        this.init.db,
        this.init.thread.id,
        requestId,
      )
      return [...past, { role: 'user', content: text }]
    }

    if (!this.providerBootstrapped) {
      // Path B: freshly-constructed ChatSession — bootstrap on first send.
      // The workspace-resident instruction file is the agent's
      // bootstrap context; acpx's session/load picks up an existing
      // record keyed on tupleKey for the resume case. Either way we
      // only need to ship the new user message.
      await bootstrapNewProvider(this.provider, tuple)
      this.providerBootstrapped = true
      return [{ role: 'user', content: text }]
    }

    if (!sameTuple) {
      // Path C: in-place config delta.
      await applyConfigDelta(this.provider, this.activeTuple, tuple)
      return [{ role: 'user', content: text }]
    }

    // Path D: pure continuation — same tuple as last turn.
    return [{ role: 'user', content: text }]
  }

  interrupt(): void {
    // Drain pending permission requests BEFORE aborting the controller.
    // The callback's abort listener also fires when the controller
    // aborts, but cancelAll runs synchronously and clears the registry
    // map so a subsequent HTTP POST to /permission/:requestId 409s
    // cleanly instead of racing with the abort path.
    cancelAllPendingPermissions(this.init.thread.id)
    this.activeAbort?.abort()
  }

  async dispose(): Promise<void> {
    cancelAllPendingPermissions(this.init.thread.id)
    this.activeAbort?.abort()
    await this.provider.close().catch(noop)
  }
}
