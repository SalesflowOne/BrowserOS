import type {
  AcpPermissionDecision,
  AcpPermissionRequest,
} from 'acpx-ai-provider'
import { nanoid } from 'nanoid'
import type {
  PermissionMode,
  PermissionOutcome,
  PermissionToolKind,
} from '../../shared/permission.js'
import type { ProtocolEvent } from './events.types.js'
import {
  cancelAll,
  deregister,
  register,
  resolve,
} from './permission-registry.js'

// Tool kinds where acpx's classifier returns a value that's safe to
// auto-approve under "auto-approve reads". Anything outside this set
// (edit, execute, delete, move, switch_mode, think, other, unknown) is
// treated as a write and escalates to the user under that mode.
const READ_KINDS: ReadonlySet<string> = new Set(['read', 'search', 'fetch'])

function isReadKind(kind: string | undefined | null): boolean {
  return kind != null && READ_KINDS.has(kind)
}

// Maps acpx's ToolKind values (`read` / `search` / `fetch` / `edit` /
// ...) to our renderer-visible PermissionToolKind union. Anything not
// in the union falls back to 'other' rather than null so the approval
// card can still pick an icon.
function normaliseKind(
  kind: AcpPermissionRequest['inferredKind'],
): PermissionToolKind | null {
  if (!kind) return null
  switch (kind) {
    case 'read':
    case 'search':
    case 'fetch':
    case 'edit':
    case 'execute':
    case 'delete':
    case 'move':
    case 'switch_mode':
    case 'think':
    case 'other':
      return kind
    default:
      // Forward-compat: kinds added upstream surface as 'other' rather
      // than null so the card still renders with a generic icon.
      return 'other'
  }
}

export interface BuildPermissionCallbackDeps {
  threadId: string
  // Getter rather than literal so the picker can update the active
  // mode mid-session without rebuilding the provider. Read fresh on
  // every callback invocation — the picker is disabled while a turn
  // streams, so mode changes only land between turns anyway.
  getPermissionMode: () => PermissionMode
  // Bridge to the EventSink; the callback uses this to emit
  // permission.request + permission.resolved events alongside the
  // turn's other events.
  emit: (event: ProtocolEvent) => Promise<void>
  // The currently-active turn's requestId. Carried on the
  // permission.request payload so the renderer can pair the card
  // with the turn it belongs to (multiple cards across multiple
  // turns is rare but possible during transcript replay).
  getActiveTurnRequestId: () => string | null
}

export function buildPermissionCallback(
  deps: BuildPermissionCallbackDeps,
): (
  req: AcpPermissionRequest,
  ctx: { signal: AbortSignal },
) => Promise<AcpPermissionDecision | undefined> {
  return async (req, { signal }) => {
    const kind = normaliseKind(req.inferredKind)
    const decision = decideAutomatically(deps.getPermissionMode(), kind)
    if (decision !== undefined) {
      // Auto-resolved. emitResolved emits both a request + resolved
      // pair so the reducer has the tool metadata; the renderer keys
      // off resolvedBy === 'auto' to render the compact breadcrumb
      // instead of a pending card.
      const requestId = nanoid(8)
      await emitResolved(deps, requestId, kind, req, decision, 'auto')
      return decision
    }
    // Escalate path — emit the pending event and wait for the user.
    const requestId = nanoid(8)
    await emitRequest(deps, requestId, kind, req)
    return await waitForUser(deps, requestId, kind, req, signal)
  }
}

// Returns a decision when the mode unambiguously decides, or
// undefined when the request needs to escalate to the user.
//
// Note: returning `undefined` from the outer callback would fall
// through to acpx's mode-based resolver, but we don't want that here
// — the picker is the source of truth, so we always either auto-
// resolve or escalate.
function decideAutomatically(
  mode: PermissionMode,
  kind: PermissionToolKind | null,
): AcpPermissionDecision | undefined {
  switch (mode) {
    case 'allow-all':
      return { outcome: 'allow_once' }
    case 'read-only':
      // Read-only: allow reads, reject everything else.
      return isReadKind(kind)
        ? { outcome: 'allow_once' }
        : { outcome: 'reject_once' }
    case 'auto-approve-reads':
      return isReadKind(kind) ? { outcome: 'allow_once' } : undefined
    case 'manual':
      return undefined
  }
}

async function emitRequest(
  deps: BuildPermissionCallbackDeps,
  requestId: string,
  kind: PermissionToolKind | null,
  req: AcpPermissionRequest,
): Promise<void> {
  const turnRequestId = deps.getActiveTurnRequestId() ?? requestId
  // The ACP raw shape has the tool call info on raw.toolCall; guard
  // every field access so a future schema change doesn't crash the
  // turn — we only need best-effort metadata for the card.
  const raw = (req.raw ?? {}) as {
    toolCall?: {
      toolCallId?: string
      title?: string
      name?: string
      rawInput?: unknown
    }
  }
  await deps.emit({
    type: 'permission.request',
    payload: {
      requestId,
      turnRequestId,
      toolCallId: raw.toolCall?.toolCallId ?? requestId,
      toolName: raw.toolCall?.title ?? raw.toolCall?.name ?? 'tool',
      toolKind: kind,
      input: raw.toolCall?.rawInput,
    },
  })
}

async function emitResolved(
  deps: BuildPermissionCallbackDeps,
  requestId: string,
  kind: PermissionToolKind | null,
  req: AcpPermissionRequest,
  decision: AcpPermissionDecision,
  resolvedBy: 'user' | 'auto' | 'cancel',
): Promise<void> {
  // For auto-resolved, emit a minimal "request" alongside so the
  // renderer has the tool name to show in the breadcrumb. Reuses the
  // same shape as the user-escalation path.
  if (resolvedBy === 'auto') {
    await emitRequest(deps, requestId, kind, req)
  }
  await deps.emit({
    type: 'permission.resolved',
    payload: {
      requestId,
      outcome: decision.outcome as PermissionOutcome,
      resolvedBy,
    },
  })
}

function waitForUser(
  deps: BuildPermissionCallbackDeps,
  requestId: string,
  kind: PermissionToolKind | null,
  req: AcpPermissionRequest,
  signal: AbortSignal,
): Promise<AcpPermissionDecision> {
  return new Promise((resolveOuter) => {
    let settled = false
    const finalize = async (
      decision: AcpPermissionDecision,
      resolvedBy: 'user' | 'cancel',
    ) => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', onAbort)
      // Always resolve the outer promise: if emitResolved throws
      // (EventSink DB write failure), the provider would otherwise
      // hang waiting forever for a decision.
      try {
        await emitResolved(deps, requestId, kind, req, decision, resolvedBy)
      } finally {
        resolveOuter(decision)
      }
    }
    const onAbort = () => {
      // turn.cancel landed while waiting. Mirror the cancelAll path so
      // the registry stays consistent even when the abort fires before
      // cancelAll has run.
      //
      // deregister BEFORE finalize: the abort path settles the
      // callback's outer promise itself, so the registry entry stops
      // being needed. Without this clear, a stale entry survives
      // until cancelAll() (which may never come if the abort fired
      // outside ChatSession.interrupt()), and a subsequent user click
      // on POST /threads/:id/permission/:requestId finds the entry,
      // resolves it into a finalize() that short-circuits on
      // `settled`, and returns {ok:true} — silently dropping the
      // user's decision while the HTTP handler reports success.
      if (!settled) {
        deregister(deps.threadId, requestId)
        finalize({ outcome: 'cancel' }, 'cancel').catch(() => undefined)
      }
    }
    if (signal.aborted) {
      finalize({ outcome: 'cancel' }, 'cancel').catch(() => undefined)
      return
    }
    signal.addEventListener('abort', onAbort, { once: true })
    register(deps.threadId, requestId, {
      resolve: (decision) => {
        // The registry's resolve is called by two paths: the HTTP
        // endpoint (user click — decision.outcome is one of the four
        // user-pickable values) and cancelAll (drain — decision.
        // outcome === 'cancel'). Differentiate so the persisted
        // permission.resolved event's resolvedBy matches the reality:
        // 'cancel' for drains, 'user' for actual clicks.
        const resolvedBy = decision.outcome === 'cancel' ? 'cancel' : 'user'
        finalize(decision, resolvedBy).catch(() => undefined)
      },
    })
  })
}

// Re-export so call sites importing the callback also get the
// cancelAll helper from one place (ChatSession.cancel uses it).
export { cancelAll as cancelAllPendingPermissions, resolve as resolvePending }
