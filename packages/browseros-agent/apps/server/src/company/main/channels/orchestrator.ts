// biome-ignore-all lint/nursery/noExcessiveLinesPerFile: state machine + streaming row lifecycle + provider build in one place
//
// Per-employee event loop. Each channel keeps `needsWake` + `busy` +
// `abortControllers` maps keyed by employee id. When a message lands,
// `kick(recipient)` runs in the background, drains the recipient's
// transcript delta since `lastSeenAt`, and loops if more landed during
// the turn. Recipients run in parallel with the still-streaming caller.
// Routing is explicit via the `messageEmployee` MCP tool; plain text
// emitted by an agent is a broadcast row that wakes no one. See
// AGENTS.md `## Channels` for the design rationale.

import type { AcpxProvider } from 'acpx-ai-provider'
import { type ModelMessage, streamText } from 'ai'
import { eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { channels } from '../../db/schema/channels.sql.js'
import { type Message, messages } from '../../db/schema/messages.sql.js'
import { DEFAULT_PERMISSION_MODE } from '../../shared/permission.js'
import { ensureAppWindow, getAppWindowId } from '../browseros/app-window.js'
import { buildBrowserosMcpServers } from '../browseros/mcp-servers.js'
import { ensureSurfaceTabGroup } from '../browseros/tab-group.js'
import { buildAcpxProvider } from '../chat/acpx-provider.js'
import { bootstrapNewProvider } from '../chat/provider-resolver.js'
import type { ChatTuple } from '../chat/tuple.js'
import { getDb } from '../db-singleton.js'
import { getBrowserosMcpUrl } from '../settings/browseros.js'
import {
  channelBootstrapBlock,
  channelDeltaBlock,
  statSoulMtime,
} from './orchestrator-prompt.js'
import {
  advanceSessionCursors,
  loadChannel,
  loadDelta,
  loadEmployee,
  loadMemberEmployees,
  loadMemberIds,
  loadOrCreateSession,
} from './orchestrator-store.js'
import {
  type ChannelEvent,
  messageRowToTranscriptEntry,
  USER_PARTICIPANT_ID,
} from './types.js'

const STREAMING_PERSIST_INTERVAL_MS = 250

interface StreamState {
  aggregateText: string
  rowId: string | null
  lastPersistedLen: number
  lastPersistAt: number
  // Newest createdAt in the delta we showed the model this turn. We
  // set the session cursor to this at turn end — NOT to MAX(createdAt)
  // of all channel rows, because rows that land during the turn (after
  // loadDelta) need to remain in the next delta. Initialised to the
  // turn-start lastSeenAt so a silent or empty-delta turn doesn't
  // rewind the cursor.
  nextLastSeenAt: number
}

interface PerChannelState {
  providers: Map<string, AcpxProvider>
  bootstrapped: Set<string>
  subscribers: Set<(e: ChannelEvent) => void>
  nextSeq: number
  needsWake: Set<string>
  busy: Set<string>
  abortControllers: Map<string, AbortController>
  // Set by `interrupt()`, cleared on the next `postFromUser`. Causes
  // in-flight `messageEmployee` MCP callbacks to drop their wake +
  // kick silently — so an agent's tool call that arrived during Stop
  // doesn't race into a fresh turn with a new AbortController.
  stopped: boolean
  // Stream state per active employee, used by `closeStreamingRow` to
  // split the in-flight text row when `messageEmployee` fires mid-turn.
  currentStreams: Map<string, StreamState>
  // Latest pageId any browseros tool in this channel touched. Read by
  // the screencast pane via the `meta.active-page-id` SSE event since
  // channel message rows don't carry tool parts.
  activePageId: number | null
}

let _orchestrator: ChannelOrchestrator | null = null

export function getChannelOrchestrator(): ChannelOrchestrator {
  if (!_orchestrator) _orchestrator = new ChannelOrchestrator()
  return _orchestrator
}

class ChannelOrchestrator {
  private states = new Map<string, PerChannelState>()
  private apiBaseUrl: string | null = null

  setApiBaseUrl(url: string): void {
    this.apiBaseUrl = url
  }

  getApiBaseUrl(): string | null {
    return this.apiBaseUrl
  }

  subscribe(channelId: string, handler: (e: ChannelEvent) => void): () => void {
    const state = this.ensureState(channelId)
    state.subscribers.add(handler)
    // Replay so the pane can bind to the right tab on connect/reload.
    // Fresh seq so the renderer's monotonic-seq gate accepts it.
    if (state.activePageId !== null) {
      handler({
        kind: 'meta.active-page-id',
        seq: this.nextSeq(channelId),
        ts: Date.now(),
        pageId: state.activePageId,
      })
    }
    return () => {
      state.subscribers.delete(handler)
    }
  }

  isAnyEmployeeBusy(channelId: string): boolean {
    return (this.states.get(channelId)?.busy.size ?? 0) > 0
  }

  isAnyChannelBusy(): boolean {
    for (const state of this.states.values()) {
      if (state.busy.size > 0) return true
    }
    return false
  }

  async postFromUser(
    channelId: string,
    text: string,
    explicitTo?: string,
  ): Promise<void> {
    const trimmed = text.trim()
    if (!trimmed) throw new Error('empty message')

    const channel = await loadChannel(channelId)
    if (!channel) throw new Error('Channel not found')
    if (channel.archivedAt) throw new Error('Channel is archived')

    const memberIds = await loadMemberIds(channelId)
    if (memberIds.length === 0) throw new Error('Channel has no members')

    // Explicit `@to` if it's a current member, else the lead.
    const target =
      explicitTo && memberIds.includes(explicitTo)
        ? explicitTo
        : channel.leadEmployeeId

    const entry = await this.appendMessage(channelId, {
      authorId: USER_PARTICIPANT_ID,
      kind: 'text',
      body: trimmed,
      toParticipantId: target,
    })
    this.emit(channelId, {
      kind: 'transcript.append',
      seq: this.nextSeq(channelId),
      ts: entry.ts,
      entry,
    })

    const state = this.ensureState(channelId)
    // Fresh post from the founder lifts any prior Stop.
    state.stopped = false
    state.needsWake.add(target)
    void this.kick(channelId, target)
  }

  /** Dispatched from `mcp-server.ts` when an agent calls
   *  `messageEmployee`. Appends the row; if the target is an employee,
   *  also marks them for wake-up and kicks their loop (possibly in
   *  parallel with the caller's still-streaming turn). */
  async receiveMessageEmployee(
    channelId: string,
    fromEmployeeId: string,
    toParticipantId: string,
    body: string,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    const trimmed = body.trim()
    if (!trimmed) return { ok: false, error: 'empty body' }
    if (toParticipantId === fromEmployeeId) {
      return { ok: false, error: 'Cannot messageEmployee yourself.' }
    }

    const memberIds = await loadMemberIds(channelId)
    if (!memberIds.includes(fromEmployeeId)) {
      return { ok: false, error: `Unknown sender: ${fromEmployeeId}` }
    }
    const isUserTarget = toParticipantId === USER_PARTICIPANT_ID
    if (!isUserTarget && !memberIds.includes(toParticipantId)) {
      return {
        ok: false,
        error: `Recipient ${toParticipantId} is not a member of this channel.`,
      }
    }

    // Finalize any in-flight text row so this messageEmployee row lands
    // chronologically after it; later text deltas start a fresh row.
    await this.closeStreamingRow(channelId, fromEmployeeId)

    const entry = await this.appendMessage(channelId, {
      authorId: fromEmployeeId,
      kind: 'text',
      body: trimmed,
      toParticipantId,
    })
    this.emit(channelId, {
      kind: 'transcript.append',
      seq: this.nextSeq(channelId),
      ts: entry.ts,
      entry,
    })

    if (isUserTarget) return { ok: true }

    const state = this.ensureState(channelId)
    // If `interrupt()` already fired while this handler was suspended
    // at an earlier `await`, drop the wake silently — otherwise we'd
    // start a fresh turn with a new AbortController that the Stop
    // never saw, producing a ghost turn after "Stopped by founder."
    if (state.stopped) return { ok: true }
    state.needsWake.add(toParticipantId)
    void this.kick(channelId, toParticipantId)
    return { ok: true }
  }

  async interrupt(channelId: string) {
    const state = this.states.get(channelId)
    if (!state || state.busy.size === 0) {
      return { interrupted: false as const }
    }
    state.stopped = true
    state.needsWake.clear()
    for (const ac of state.abortControllers.values()) ac.abort()
    await this.appendSystemMessage(channelId, 'Stopped by founder.')
    return { interrupted: true as const }
  }

  async appendSystemMessage(channelId: string, body: string): Promise<void> {
    const entry = await this.appendMessage(channelId, {
      authorId: 'system',
      kind: 'system',
      body,
      toParticipantId: null,
    })
    this.emit(channelId, {
      kind: 'transcript.append',
      seq: this.nextSeq(channelId),
      ts: entry.ts,
      entry,
    })
  }

  async disposeProviders(): Promise<void> {
    const all: AcpxProvider[] = []
    for (const state of this.states.values()) {
      for (const provider of state.providers.values()) all.push(provider)
      state.providers.clear()
      state.bootstrapped.clear()
    }
    await Promise.allSettled(all.map((p) => p.close()))
  }

  async disposeChannel(channelId: string): Promise<void> {
    const state = this.states.get(channelId)
    if (!state) return
    const providers = [...state.providers.values()]
    this.states.delete(channelId)
    await Promise.allSettled(providers.map((p) => p.close()))
  }

  /** Drop cached providers but keep subscribers + wake flags so the
   *  next turn rebuilds with a fresh `X-BrowserOS-Default-Window-Id`. */
  async invalidateBrowserosWiring(channelId: string): Promise<void> {
    const state = this.states.get(channelId)
    if (!state) return
    const providers = [...state.providers.values()]
    state.providers.clear()
    state.bootstrapped.clear()
    await Promise.allSettled(providers.map((p) => p.close()))
  }

  /** Drain loop for one employee. Idempotent: if already busy this is
   *  a no-op (the running loop picks up the wake flag next iteration). */
  private async kick(channelId: string, employeeId: string): Promise<void> {
    const state = this.ensureState(channelId)
    if (state.stopped) return
    if (state.busy.has(employeeId)) return
    if (!state.needsWake.has(employeeId)) return
    state.busy.add(employeeId)
    state.needsWake.delete(employeeId)
    try {
      while (true) {
        await this.runTurn(channelId, employeeId)
        if (!state.needsWake.has(employeeId)) break
        state.needsWake.delete(employeeId)
      }
    } finally {
      state.busy.delete(employeeId)
    }
  }

  private async runTurn(channelId: string, employeeId: string): Promise<void> {
    const state = this.ensureState(channelId)
    const abort = new AbortController()
    state.abortControllers.set(employeeId, abort)

    this.emit(channelId, {
      kind: 'turn.start',
      seq: this.nextSeq(channelId),
      ts: Date.now(),
      employeeId,
    })

    const streamState: StreamState = {
      aggregateText: '',
      rowId: null,
      lastPersistedLen: 0,
      lastPersistAt: 0,
      nextLastSeenAt: 0,
    }
    try {
      await this.ensureFreshBrowserosWiring(channelId)
      await this.streamAgentTurn(
        channelId,
        employeeId,
        streamState,
        abort.signal,
      )
      await this.finalizeTurnAfterStream(
        channelId,
        employeeId,
        streamState,
        abort.signal.aborted,
      )
    } catch (err) {
      const aborted = abort.signal.aborted
      if (streamState.rowId !== null) {
        await this.finalizeStreamingRow(
          channelId,
          streamState.rowId,
          streamState.aggregateText,
          'error',
        )
      }
      this.emit(channelId, {
        kind: 'turn.end',
        seq: this.nextSeq(channelId),
        ts: Date.now(),
        employeeId,
        status: aborted ? 'cancelled' : 'error',
        message: aborted
          ? 'cancelled by founder'
          : err instanceof Error
            ? err.message
            : 'turn failed',
      })
    } finally {
      state.abortControllers.delete(employeeId)
      state.currentStreams.delete(employeeId)
    }
  }

  private async streamAgentTurn(
    channelId: string,
    employeeId: string,
    streamState: StreamState,
    signal: AbortSignal,
  ): Promise<void> {
    this.ensureState(channelId).currentStreams.set(employeeId, streamState)
    const { messages: messagesForTurn, nextLastSeenAt } =
      await this.buildMessagesForTurn(channelId, employeeId)
    streamState.nextLastSeenAt = nextLastSeenAt
    const provider = await this.ensureProvider(channelId, employeeId)
    const result = streamText({
      model: provider.languageModel(),
      messages: messagesForTurn,
      abortSignal: signal,
    })
    for await (const part of result.fullStream) {
      const evts = this.translatePart(channelId, employeeId, part)
      for (const ev of evts) {
        if (ev.kind === 'text.delta') {
          await this.onTextDelta(channelId, employeeId, ev.text, streamState)
        }
        this.emit(channelId, ev)
      }
    }
  }

  private async onTextDelta(
    channelId: string,
    employeeId: string,
    chunk: string,
    s: StreamState,
  ): Promise<void> {
    // Lazy-create the streaming row with an empty body — the renderer
    // accumulates from `text.delta`, so seeding non-empty double-counts.
    if (s.rowId === null) {
      s.rowId = await this.startStreamingRow(channelId, employeeId)
      s.lastPersistedLen = 0
      s.lastPersistAt = Date.now()
    }
    s.aggregateText += chunk
    const now = Date.now()
    if (
      now - s.lastPersistAt >= STREAMING_PERSIST_INTERVAL_MS &&
      s.aggregateText.length > s.lastPersistedLen
    ) {
      await this.persistStreamingBody(s.rowId, s.aggregateText)
      s.lastPersistedLen = s.aggregateText.length
      s.lastPersistAt = now
    }
  }

  private translatePart(
    channelId: string,
    employeeId: string,
    part: unknown,
  ): ChannelEvent[] {
    if (typeof part !== 'object' || part === null) return []
    const o = part as Record<string, unknown>
    const type = typeof o.type === 'string' ? o.type : ''
    const id = typeof o.id === 'string' ? o.id : undefined
    const text = typeof o.text === 'string' ? o.text : undefined
    const delta = typeof o.delta === 'string' ? o.delta : undefined
    const chunk = text ?? delta
    if (type === 'text-delta' && id && chunk) {
      return [
        {
          kind: 'text.delta',
          seq: this.nextSeq(channelId),
          ts: Date.now(),
          employeeId,
          blockId: id,
          text: chunk,
        },
      ]
    }
    if (type === 'text-end' && id) {
      return [
        {
          kind: 'text.end',
          seq: this.nextSeq(channelId),
          ts: Date.now(),
          employeeId,
          blockId: id,
        },
      ]
    }
    if (type === 'tool-result' || type === 'tool-call') {
      return this.maybeEmitActivePageIdFromTool(channelId, o)
    }
    return []
  }

  private maybeEmitActivePageIdFromTool(
    channelId: string,
    part: Record<string, unknown>,
  ): ChannelEvent[] {
    const toolName = typeof part.toolName === 'string' ? part.toolName : ''
    if (!toolName) return []
    if (!/(?:^|[/_\s])browseros[/_]/i.test(toolName)) return []
    const pageId =
      readPageIdFromValue(part.output) ?? readPageIdFromValue(part.input)
    if (pageId === null) return []
    const state = this.ensureState(channelId)
    if (state.activePageId === pageId) return []
    state.activePageId = pageId
    return [
      {
        kind: 'meta.active-page-id',
        seq: this.nextSeq(channelId),
        ts: Date.now(),
        pageId,
      },
    ]
  }

  // If `wasAborted`, the row goes to `'error'` and we skip the cursor
  // advance so the next wake re-sees the in-flight context.
  private async finalizeTurnAfterStream(
    channelId: string,
    employeeId: string,
    streamState: StreamState,
    wasAborted: boolean,
  ): Promise<void> {
    if (streamState.rowId !== null) {
      await this.finalizeStreamingRow(
        channelId,
        streamState.rowId,
        streamState.aggregateText,
        wasAborted ? 'error' : 'complete',
      )
    }
    if (!wasAborted) {
      const employee = await loadEmployee(employeeId)
      const soulMtime = await statSoulMtime(employee?.workspacePath ?? null)
      await advanceSessionCursors(
        channelId,
        employeeId,
        streamState.nextLastSeenAt,
        soulMtime,
      )
    }
    this.emit(channelId, {
      kind: 'turn.end',
      seq: this.nextSeq(channelId),
      ts: Date.now(),
      employeeId,
      status: wasAborted ? 'cancelled' : 'completed',
      ...(wasAborted ? { message: 'cancelled by founder' } : {}),
    })
  }

  private async ensureProvider(
    channelId: string,
    employeeId: string,
  ): Promise<AcpxProvider> {
    const state = this.ensureState(channelId)
    const cached = state.providers.get(employeeId)
    if (cached) {
      if (!state.bootstrapped.has(employeeId)) {
        await bootstrapNewProvider(cached, await this.tupleFor(employeeId))
        state.bootstrapped.add(employeeId)
      }
      return cached
    }
    const provider = await this.buildProvider(channelId, employeeId)
    state.providers.set(employeeId, provider)
    await bootstrapNewProvider(provider, await this.tupleFor(employeeId))
    state.bootstrapped.add(employeeId)
    return provider
  }

  private async buildProvider(
    channelId: string,
    employeeId: string,
  ): Promise<AcpxProvider> {
    const row = await loadEmployee(employeeId)
    if (!row) throw new Error(`Unknown employee: ${employeeId}`)
    if (!this.apiBaseUrl) {
      throw new Error('API base URL not set on channel orchestrator yet')
    }
    const tuple = await this.tupleFor(employeeId)
    const fakeThread = {
      id: `channel-${channelId}-${employeeId}`,
    } as unknown as Parameters<typeof buildAcpxProvider>[0]['thread']

    const channelMcp = {
      type: 'http' as const,
      name: 'channel',
      url: `${this.apiBaseUrl}/channels/${channelId}/mcp`,
      headers: {
        'X-Channel-Id': channelId,
        'X-Employee-Id': employeeId,
      },
    }
    const browserosMcp = await this.tryBuildBrowserosMcp(channelId, employeeId)

    return buildAcpxProvider({
      tuple,
      thread: fakeThread,
      sessionKeyOverride: `channel::${channelId}::${employeeId}`,
      mcpServers: [channelMcp, ...browserosMcp],
      // Channels don't expose a per-thread permission picker yet —
      // default to auto-approve-reads + no protocol-event sink + no
      // active-turn requestId. If we add per-channel permissions
      // later, plumb them in here the way ChatSession does.
      getPermissionMode: () => DEFAULT_PERMISSION_MODE,
      writeProtocolEvent: async () => undefined,
      getActiveTurnRequestId: () => null,
    })
  }

  /** Pre-turn probe: if the shared app BrowserOS window died while we
   *  were idle, drop the cached providers so the next ensureProvider
   *  rebuilds them with a fresh windowId AND a fresh tabGroupId.
   *  Best-effort. */
  private async ensureFreshBrowserosWiring(channelId: string): Promise<void> {
    try {
      const db = getDb()
      const stored = await getAppWindowId(db)
      const browserosUrl = await getBrowserosMcpUrl(db)
      // Cheap: ensureAppWindow returns the same id when alive, recreates
      // when dead. If the id changed, our cached wiring is stale.
      const live = await ensureAppWindow(db, browserosUrl)
      let needsRebuild = stored !== null && live !== stored
      const channel = await loadChannel(channelId)
      if (channel) {
        const ensured = await ensureSurfaceTabGroup(db, browserosUrl, live, {
          kind: 'channel',
          id: channel.id,
          name: channel.name,
          tint: 'blue',
        })
        if (ensured.recreated) needsRebuild = true
      }
      if (needsRebuild) await this.invalidateBrowserosWiring(channelId)
    } catch (err) {
      // biome-ignore lint/suspicious/noConsole: degraded-state warning, surfaced once per turn so debugging is grep-able
      console.warn(
        `[channels:${channelId}] pre-turn browseros liveness check failed:`,
        err,
      )
    }
  }

  private async tryBuildBrowserosMcp(
    channelId: string,
    employeeId: string,
  ): Promise<ReturnType<typeof buildBrowserosMcpServers>> {
    try {
      const db = getDb()
      const browserosUrl = await getBrowserosMcpUrl(db)
      const channel = await loadChannel(channelId)
      if (!channel) return []
      const windowId = await ensureAppWindow(db, browserosUrl)
      const ensured = await ensureSurfaceTabGroup(db, browserosUrl, windowId, {
        kind: 'channel',
        id: channel.id,
        name: channel.name,
        tint: 'blue',
      })
      return buildBrowserosMcpServers(
        channelId,
        employeeId,
        browserosUrl,
        windowId,
        ensured.tabGroupId,
      )
    } catch (err) {
      // biome-ignore lint/suspicious/noConsole: BrowserOS unreachable is a known degraded state — surface it once at provider-build time so debugging is grep-able
      console.warn(
        `[channels:${channelId}] BrowserOS setup failed; channel session built without browser surface:`,
        err,
      )
      return []
    }
  }

  private async tupleFor(employeeId: string): Promise<ChatTuple> {
    const row = await loadEmployee(employeeId)
    if (!row) throw new Error(`Unknown employee: ${employeeId}`)
    return {
      agentKind: row.agentKind,
      modelId: row.modelId,
      workspacePath: row.workspacePath,
      reasoningEffort: row.reasoningEffort,
    }
  }

  private async buildMessagesForTurn(
    channelId: string,
    employeeId: string,
  ): Promise<{ messages: ModelMessage[]; nextLastSeenAt: number }> {
    const session = await loadOrCreateSession(channelId, employeeId)
    const employee = await loadEmployee(employeeId)
    if (!employee) throw new Error(`Unknown employee: ${employeeId}`)

    const channel = await loadChannel(channelId)
    const delta = await loadDelta(channelId, session.lastSeenAt)
    const memberRoster = await loadMemberEmployees(channelId)

    // Cursor advances to the newest row in THIS delta — not to
    // MAX(createdAt) at turn-end. Rows that land mid-turn (after this
    // loadDelta) have a larger createdAt and stay in the next delta.
    const nextLastSeenAt =
      delta.length > 0
        ? (delta.at(-1)?.createdAt.getTime() ?? session.lastSeenAt)
        : session.lastSeenAt

    // Bootstrap once per provider — the agent's CLI session memory
    // keeps the block across continuation turns.
    const isBootstrap =
      !this.ensureState(channelId).bootstrapped.has(employeeId)

    const userBlocks: string[] = []
    if (isBootstrap) {
      userBlocks.push(
        channelBootstrapBlock(
          channel?.name ?? channelId,
          channel?.topic ?? null,
          employeeId,
          memberRoster,
        ),
      )
    }
    userBlocks.push(channelDeltaBlock(employeeId, delta, memberRoster))

    return {
      messages: [{ role: 'user', content: userBlocks.join('\n\n') }],
      nextLastSeenAt,
    }
  }

  private async appendMessage(
    channelId: string,
    partial: {
      authorId: string
      kind: Message['kind']
      body: string
      toParticipantId: string | null
    },
  ): Promise<ReturnType<typeof messageRowToTranscriptEntry>> {
    const db = getDb()
    const now = new Date()
    const row: Message = {
      id: nanoid(),
      surface: 'channel',
      surfaceId: channelId,
      authorId: partial.authorId,
      kind: partial.kind,
      body: partial.body,
      approvalId: null,
      toParticipantId: partial.toParticipantId,
      status: 'complete',
      createdAt: now,
    }
    await db.insert(messages).values(row)
    await this.touchChannel(channelId, now)
    return messageRowToTranscriptEntry(row)
  }

  /** Plain-text streaming row — `toParticipantId: null` because plain
   *  text is a broadcast. Recipient-bound rows come from
   *  `receiveMessageEmployee` as completed inserts. */
  private async startStreamingRow(
    channelId: string,
    employeeId: string,
  ): Promise<string> {
    const db = getDb()
    const now = new Date()
    const row: Message = {
      id: nanoid(),
      surface: 'channel',
      surfaceId: channelId,
      authorId: employeeId,
      kind: 'text',
      body: '',
      approvalId: null,
      toParticipantId: null,
      status: 'streaming',
      createdAt: now,
    }
    await db.insert(messages).values(row)
    await this.touchChannel(channelId, now)
    this.emit(channelId, {
      kind: 'transcript.append',
      seq: this.nextSeq(channelId),
      ts: now.getTime(),
      entry: messageRowToTranscriptEntry(row),
    })
    return row.id
  }

  private async persistStreamingBody(
    rowId: string,
    body: string,
  ): Promise<void> {
    const db = getDb()
    await db.update(messages).set({ body }).where(eq(messages.id, rowId))
  }

  /** Finalize the in-flight streaming row and reset its state so the
   *  next text-delta starts a fresh row. No-op if no streaming row. */
  private async closeStreamingRow(
    channelId: string,
    employeeId: string,
  ): Promise<void> {
    const state = this.states.get(channelId)
    const s = state?.currentStreams.get(employeeId)
    if (!s || s.rowId === null) return
    await this.finalizeStreamingRow(
      channelId,
      s.rowId,
      s.aggregateText,
      'complete',
    )
    s.rowId = null
    s.aggregateText = ''
    s.lastPersistedLen = 0
    s.lastPersistAt = 0
  }

  private async finalizeStreamingRow(
    channelId: string,
    rowId: string,
    body: string,
    status: 'complete' | 'error',
  ): Promise<void> {
    const db = getDb()
    await db
      .update(messages)
      .set({ body, status })
      .where(eq(messages.id, rowId))
    const rows = await db
      .select()
      .from(messages)
      .where(eq(messages.id, rowId))
      .limit(1)
    const row = rows[0]
    if (!row) return
    this.emit(channelId, {
      kind: 'transcript.append',
      seq: this.nextSeq(channelId),
      ts: row.createdAt.getTime(),
      entry: messageRowToTranscriptEntry(row),
    })
    await this.touchChannel(channelId, new Date())
  }

  private async touchChannel(channelId: string, now: Date): Promise<void> {
    const db = getDb()
    await db
      .update(channels)
      .set({ updatedAt: now })
      .where(eq(channels.id, channelId))
  }

  private ensureState(channelId: string): PerChannelState {
    const existing = this.states.get(channelId)
    if (existing) return existing
    const fresh: PerChannelState = {
      providers: new Map(),
      bootstrapped: new Set(),
      subscribers: new Set(),
      nextSeq: 0,
      needsWake: new Set(),
      busy: new Set(),
      abortControllers: new Map(),
      stopped: false,
      currentStreams: new Map(),
      activePageId: null,
    }
    this.states.set(channelId, fresh)
    return fresh
  }

  private emit(channelId: string, event: ChannelEvent): void {
    const state = this.states.get(channelId)
    if (!state) return
    for (const sub of state.subscribers) {
      try {
        sub(event)
      } catch {
        // Per-subscriber failures must not break the dispatch loop.
      }
    }
  }

  private nextSeq(channelId: string): number {
    const state = this.ensureState(channelId)
    const seq = state.nextSeq
    state.nextSeq = seq + 1
    return seq
  }
}

// Creator tools (new_page) put the id on `output.pageId`; action
// tools take it as `input.page`. AI SDK passes values as objects, but
// some flatten to a JSON string or a prose blob with embedded JSON,
// so all three shapes need to be handled.
const PAGE_ID_RE =
  /\bpage(?:[_\-\s]*id)?\s*["']?\s*(?:is\s+|[:=]\s*)\s*[*`'"]*(\d+)/i

function readPageIdFromValue(value: unknown): number | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>
    for (const candidate of [obj.pageId, obj.page]) {
      if (
        typeof candidate === 'number' &&
        Number.isInteger(candidate) &&
        candidate > 0
      ) {
        return candidate
      }
    }
    return matchPageIdInText(JSON.stringify(value))
  }
  if (typeof value !== 'string') return null
  try {
    const fromParsed = readPageIdFromValue(JSON.parse(value))
    if (fromParsed !== null) return fromParsed
  } catch {
    // Fall through to the regex scan on the raw string.
  }
  return matchPageIdInText(value)
}

function matchPageIdInText(text: string): number | null {
  const match = PAGE_ID_RE.exec(text)
  if (!match) return null
  const raw = match[1]
  if (raw === undefined) return null
  const n = Number(raw)
  return Number.isInteger(n) && n > 0 ? n : null
}
