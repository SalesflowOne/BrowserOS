// biome-ignore-all lint/nursery/noExcessiveLinesPerFile: event types, reducer family and the SSE hook live together so the state machine stays readable in one window — splitting them just for the line cap fragments the data flow
import { useEffect, useReducer, useRef } from 'react'
import type {
  PermissionOutcome,
  PermissionToolKind,
} from '../../../shared/permission'
import { API_BASE_URL } from './client'
import { useEmployeesWithRecentThreads } from './employees.hooks'
import { queryClient } from './queryClient'

type EventKind =
  | 'turn.start'
  | 'text.delta'
  | 'text.end'
  | 'tool.call.proposed'
  | 'tool.result'
  | 'tool.approval.requested'
  | 'mcp.connect_required'
  | 'thread.title_changed'
  | 'permission.request'
  | 'permission.resolved'
  | 'meta.turn-input'
  | 'turn.end'
  | 'turn.cancel'
  | 'error'

const EVENT_KINDS: EventKind[] = [
  'turn.start',
  'text.delta',
  'text.end',
  'tool.call.proposed',
  'tool.result',
  'tool.approval.requested',
  'mcp.connect_required',
  'thread.title_changed',
  'permission.request',
  'permission.resolved',
  'meta.turn-input',
  'turn.end',
  'turn.cancel',
  'error',
]

interface StreamedEvent {
  id: string
  seq: number
  kind: EventKind
  payload: Record<string, unknown>
  ts: number
}

export type ToolState =
  | 'input-streaming'
  | 'input-available'
  | 'approval-requested'
  | 'approval-responded'
  | 'output-available'
  | 'output-error'

export interface TextPart {
  kind: 'text'
  id: string
  text: string
  ended: boolean
}

export interface ReasoningPart {
  kind: 'reasoning'
  id: string
  text: string
  ended: boolean
  // Some agents prefix plan-mode reasoning with `[Plan] ` so the renderer
  // can visually distinguish a plan from a normal chain-of-thought. The
  // reducer strips the prefix on first encounter and flips this flag —
  // the badge stays sticky for the rest of the block.
  isPlan: boolean
}

export interface ToolPart {
  kind: 'tool'
  id: string
  toolName: string
  input: unknown
  output?: unknown
  isError?: boolean
  state: ToolState
  // Set when a `tool.approval.requested` event lands for this call.
  // The renderer looks the approval up in the approvals cache to show
  // the inline Approve / Reject controls next to the tool input.
  approvalId?: string
}

// Emitted in place of a ToolPart when the LLM calls a klavis nudge
// (e.g. suggest_app_connection) and the user needs to authorize a
// third-party toolkit. The renderer shows a ConnectAppCard instead
// of a generic tool block. `id` is the originating toolCallId so the
// reducer can dedupe on SSE replay.
export interface McpConnectPart {
  kind: 'mcp-connect'
  id: string
  toolkit: string
  reason: string
}

// Inline acpx-provider permission gate. State starts at 'pending'
// when permission.request arrives and transitions to 'resolved' on
// the matching permission.resolved. resolvedBy === 'auto' means the
// thread's mode short-circuited the request — renderer collapses
// these into a compact one-line breadcrumb instead of a full card.
export interface PermissionPart {
  kind: 'permission'
  id: string // = requestId
  turnRequestId: string
  toolCallId: string
  toolName: string
  toolKind: PermissionToolKind | null
  input?: unknown
  state: 'pending' | 'resolved'
  outcome?: PermissionOutcome
  resolvedBy?: 'user' | 'auto' | 'cancel'
}

export type MessagePart =
  | TextPart
  | ReasoningPart
  | ToolPart
  | McpConnectPart
  | PermissionPart

export type TurnStatus = 'streaming' | 'completed' | 'cancelled' | 'error'

export interface ChatTurn {
  requestId: string
  // The prompt that started this turn — captured from turn.start so the
  // user bubble can render without a second round-trip to the messages
  // table.
  userMessage: string
  // Timestamp of the turn.start event (ms epoch). Used to interleave
  // turns with non-turn surfaces like approvals when rendering.
  startedAt: number
  // Agent + model that actually ran this turn. Captured from turn.start
  // so the metadata header reflects the exact provider that produced the
  // response, even after the user switches the composer tuple to
  // something else for the next turn.
  agentKind?: string
  modelId?: string | null
  // Ordered parts in the order they were emitted. The renderer walks
  // this single list and dispatches per kind — keeps chronology
  // straight when text, reasoning and tool calls interleave inside one
  // turn.
  parts: MessagePart[]
  status: TurnStatus
  errorMessage?: string
  errorCode?: string
  errorDetails?: string
}

// Rolling metrics for the EmployeeBusy indicator. Lives parallel to
// `live` so the indicator reads elapsed / output-char / input-char
// without re-deriving from event history on every render. Cleared on
// any terminal event (turn.end / turn.cancel / error).
export interface ActiveAssistant {
  requestId: string
  // ms epoch, anchors the elapsed-seconds cell. Sourced from the
  // turn.start event's `ts` so replay places it correctly.
  startedAt: number
  // Accumulated chars from text.delta (+ reasoning deltas via the
  // payload's `reasoning: true` flag). Converted to a token estimate
  // at render time via `chars / 4`. Append-only; never decremented.
  liveOutputChars: number
  // Populated by meta.turn-input shortly after turn.start. The
  // indicator hides the `↑ ~N tok` cell until this is set so the row
  // doesn't jitter from left-fill.
  approxInputChars?: number
}

interface State {
  history: ChatTurn[]
  live: ChatTurn | null
  activeAssistant: ActiveAssistant | null
  lastSeq: number
}

interface ThreadTitlePayload {
  threadId: string
  title: string
}

// Server-driven title change (the agent called `set_thread_title`).
// Patches the React Query cache so the rail re-renders without a
// refetch. Two query trees are touched: the per-employee thread list
// (`['threads', 'employee', { employeeId }]`) and the bulk recent-
// threads read (`['employees', 'with-recent-threads', ...]`). The query
// keys are duplicated here from threads.hooks.ts / employees.hooks.ts
// — keep them in sync if those keys change.
function applyTitleChange(payload: ThreadTitlePayload): void {
  type Row = { id: string; title: string } & Record<string, unknown>
  type EmployeeWithRecent = { recentThreads: Row[] } & Record<string, unknown>

  queryClient.setQueriesData<Row[]>(
    { queryKey: ['threads', 'employee'] },
    (rows) => {
      if (!rows) return rows
      return rows.map((r) =>
        r.id === payload.threadId ? { ...r, title: payload.title } : r,
      )
    },
  )
  queryClient.setQueriesData<EmployeeWithRecent[]>(
    { queryKey: ['employees', 'with-recent-threads'] },
    (entries) => {
      if (!entries) return entries
      return entries.map((emp) => ({
        ...emp,
        recentThreads: emp.recentThreads.map((t) =>
          t.id === payload.threadId ? { ...t, title: payload.title } : t,
        ),
      }))
    },
  )
}

type Action = { type: 'events'; events: StreamedEvent[] } | { type: 'reset' }

const INITIAL_STATE: State = {
  history: [],
  live: null,
  activeAssistant: null,
  lastSeq: -1,
}

function reduce(state: State, action: Action): State {
  if (action.type === 'reset') return INITIAL_STATE
  // Apply the whole batch in one pass so each animation frame produces a
  // single React render no matter how many SSE deltas landed inside it.
  // Without this, a model emitting tokens faster than the renderer can
  // keep up dispatches one reducer action (and one render) per event,
  // pegging the live row at the network event rate.
  let next = state
  for (const event of action.events) {
    if (event.seq <= next.lastSeq) continue
    next = applyEvent(next, event)
  }
  return next
}

function applyEvent(state: State, event: StreamedEvent): State {
  if (event.kind === 'turn.start') {
    // Defensive: if a prior turn somehow didn't terminate, keep it on
    // record before starting the next one. acpx + cancel paths should
    // always emit a terminal event, but the renderer shouldn't lose data
    // if they don't.
    const history = state.live ? [...state.history, state.live] : state.history
    const requestId = String(event.payload.requestId ?? '')
    return {
      history,
      live: startTurn(event),
      activeAssistant: {
        requestId,
        startedAt: event.ts,
        liveOutputChars: 0,
      },
      lastSeq: event.seq,
    }
  }
  if (!state.live) {
    // Event for a turn we never saw start (e.g. partial replay window).
    // Discard rather than synthesise — the cursor moves so we stay in sync
    // with subsequent events.
    return { ...state, lastSeq: event.seq }
  }
  const reducer = REDUCERS[event.kind]
  const nextLive = reducer ? reducer(state.live, event) : state.live
  const nextActive = applyActiveAssistantEvent(state.activeAssistant, event)
  if (
    event.kind === 'turn.end' ||
    event.kind === 'turn.cancel' ||
    event.kind === 'error'
  ) {
    return {
      history: [...state.history, nextLive],
      live: null,
      // Clear the indicator metrics on terminal events, same beat as
      // the live turn moving to history.
      activeAssistant: null,
      lastSeq: event.seq,
    }
  }
  return {
    history: state.history,
    live: nextLive,
    activeAssistant: nextActive,
    lastSeq: event.seq,
  }
}

// Side-car reducer for the EmployeeBusy metrics. Append-only; never
// decremented (terminal events clear the whole record in applyEvent
// above). meta.turn-input patches the input-char estimate; text.delta
// bumps the output-char accumulator (chars / 4 → token estimate on
// the renderer side).
function applyActiveAssistantEvent(
  active: ActiveAssistant | null,
  event: StreamedEvent,
): ActiveAssistant | null {
  if (!active) return active
  if (event.kind === 'meta.turn-input') {
    const requestId = String(event.payload.requestId ?? '')
    if (requestId !== active.requestId) return active
    const raw = event.payload.approxInputChars
    const value = typeof raw === 'number' ? raw : Number(raw ?? 0)
    return { ...active, approxInputChars: value }
  }
  if (event.kind === 'text.delta') {
    const chunk = String(event.payload.text ?? '')
    if (!chunk) return active
    return { ...active, liveOutputChars: active.liveOutputChars + chunk.length }
  }
  return active
}

function startTurn(event: StreamedEvent): ChatTurn {
  const agentKind =
    typeof event.payload.agentKind === 'string'
      ? event.payload.agentKind
      : undefined
  const rawModel = event.payload.modelId
  const modelId =
    typeof rawModel === 'string'
      ? rawModel
      : rawModel === null
        ? null
        : undefined
  return {
    requestId: String(event.payload.requestId ?? ''),
    userMessage: String(event.payload.userMessage ?? ''),
    startedAt: event.ts,
    agentKind,
    modelId,
    parts: [],
    status: 'streaming',
  }
}

type Reducer = (turn: ChatTurn, event: StreamedEvent) => ChatTurn

const REDUCERS: Record<EventKind, Reducer | null> = {
  'turn.start': null,
  'text.delta': withDelta,
  'text.end': withEndedBlock,
  'tool.call.proposed': withToolCall,
  'tool.result': withToolResult,
  'tool.approval.requested': withApprovalRequested,
  'mcp.connect_required': withMcpConnect,
  // Thread metadata — doesn't belong on the per-turn timeline. The SSE
  // handler short-circuits and patches the React Query cache directly
  // (see `applyTitleChange` below).
  'thread.title_changed': null,
  'permission.request': withPermissionRequest,
  'permission.resolved': withPermissionResolved,
  // EmployeeBusy metric, doesn't touch the per-turn parts list. Handled
  // by applyActiveAssistantEvent above so the indicator gets the input-
  // char estimate without re-deriving from event history.
  'meta.turn-input': null,
  'turn.end': (t) => ({ ...t, status: 'completed' }),
  'turn.cancel': (t) => ({ ...t, status: 'cancelled' }),
  error: withErrorState,
}

function withErrorState(turn: ChatTurn, event: StreamedEvent): ChatTurn {
  const code =
    typeof event.payload.code === 'string' && event.payload.code.length > 0
      ? event.payload.code
      : undefined
  const details =
    typeof event.payload.details === 'string' &&
    event.payload.details.length > 0
      ? event.payload.details
      : undefined
  return {
    ...turn,
    status: 'error',
    errorMessage: String(event.payload.message ?? 'Unknown error'),
    errorCode: code,
    errorDetails: details,
  }
}

const PLAN_PREFIX = '[Plan] '

function detectPlan(text: string): { text: string; isPlan: boolean } {
  return text.startsWith(PLAN_PREFIX)
    ? { text: text.slice(PLAN_PREFIX.length), isPlan: true }
    : { text, isPlan: false }
}

function withDelta(turn: ChatTurn, event: StreamedEvent): ChatTurn {
  const blockId = String(event.payload.blockId ?? '')
  const chunk = String(event.payload.text ?? '')
  const reasoning = Boolean(event.payload.reasoning)
  const existing = turn.parts.find(
    (p): p is TextPart | ReasoningPart =>
      (p.kind === 'text' || p.kind === 'reasoning') && p.id === blockId,
  )
  if (existing) {
    // Plan detection runs against the accumulated text on every delta
    // until the flag flips — the prefix can land split across two
    // chunks if it straddles the SSE batch boundary.
    return {
      ...turn,
      parts: turn.parts.map((p) => {
        if ((p.kind !== 'text' && p.kind !== 'reasoning') || p.id !== blockId) {
          return p
        }
        const next = p.text + chunk
        if (p.kind === 'reasoning' && !p.isPlan) {
          const detected = detectPlan(next)
          return { ...p, text: detected.text, isPlan: detected.isPlan }
        }
        return { ...p, text: next }
      }),
    }
  }
  if (reasoning) {
    const detected = detectPlan(chunk)
    const fresh: ReasoningPart = {
      kind: 'reasoning',
      id: blockId,
      text: detected.text,
      ended: false,
      isPlan: detected.isPlan,
    }
    return { ...turn, parts: [...turn.parts, fresh] }
  }
  const fresh: TextPart = {
    kind: 'text',
    id: blockId,
    text: chunk,
    ended: false,
  }
  return { ...turn, parts: [...turn.parts, fresh] }
}

function withEndedBlock(turn: ChatTurn, event: StreamedEvent): ChatTurn {
  const blockId = String(event.payload.blockId ?? '')
  const text = String(event.payload.text ?? '')
  const reasoning = Boolean(event.payload.reasoning)
  const seen = turn.parts.some(
    (p) => (p.kind === 'text' || p.kind === 'reasoning') && p.id === blockId,
  )
  if (!seen) {
    if (reasoning) {
      const detected = detectPlan(text)
      const fresh: ReasoningPart = {
        kind: 'reasoning',
        id: blockId,
        text: detected.text,
        ended: true,
        isPlan: detected.isPlan,
      }
      return { ...turn, parts: [...turn.parts, fresh] }
    }
    const fresh: TextPart = { kind: 'text', id: blockId, text, ended: true }
    return { ...turn, parts: [...turn.parts, fresh] }
  }
  return {
    ...turn,
    parts: turn.parts.map((p) => {
      if ((p.kind !== 'text' && p.kind !== 'reasoning') || p.id !== blockId) {
        return p
      }
      if (p.kind === 'reasoning') {
        // text.end carries the full block payload, which may still
        // include the [Plan] prefix even when withDelta already stripped
        // it from p.text mid-stream. Re-strip on every end so the prefix
        // never re-enters the rendered text once detected; keep the
        // flag sticky with `||` to cover the rare end-only delivery.
        const detected = detectPlan(text)
        return {
          ...p,
          text: detected.text,
          ended: true,
          isPlan: p.isPlan || detected.isPlan,
        }
      }
      return { ...p, text, ended: true }
    }),
  }
}

// Pushes a pending PermissionPart for an acpx onPermissionRequest
// escalation. Dedup against SSE replay so a reconnect mid-decision
// doesn't show two cards for the same requestId.
function withPermissionRequest(turn: ChatTurn, event: StreamedEvent): ChatTurn {
  const requestId = String(event.payload.requestId ?? '')
  if (turn.parts.some((p) => p.kind === 'permission' && p.id === requestId)) {
    return turn
  }
  const fresh: PermissionPart = {
    kind: 'permission',
    id: requestId,
    turnRequestId: String(event.payload.turnRequestId ?? requestId),
    toolCallId: String(event.payload.toolCallId ?? ''),
    toolName: String(event.payload.toolName ?? 'tool'),
    toolKind: (event.payload.toolKind ?? null) as PermissionToolKind | null,
    input: event.payload.input,
    state: 'pending',
  }
  return { ...turn, parts: [...turn.parts, fresh] }
}

// Transitions a PermissionPart from pending to resolved. The card's
// final tone is driven by outcome + resolvedBy: 'auto' renders the
// compact breadcrumb, 'user' / 'cancel' render the resolved card.
// If the request event was missed on replay, materialise a minimal
// resolved part so the breadcrumb still appears in scrollback.
function withPermissionResolved(
  turn: ChatTurn,
  event: StreamedEvent,
): ChatTurn {
  const requestId = String(event.payload.requestId ?? '')
  const outcome = event.payload.outcome as PermissionOutcome | undefined
  const resolvedBy = (event.payload.resolvedBy ?? 'user') as
    | 'user'
    | 'auto'
    | 'cancel'
  const seen = turn.parts.some(
    (p) => p.kind === 'permission' && p.id === requestId,
  )
  if (!seen) {
    const fresh: PermissionPart = {
      kind: 'permission',
      id: requestId,
      turnRequestId: requestId,
      toolCallId: '',
      toolName: 'tool',
      toolKind: null,
      state: 'resolved',
      outcome,
      resolvedBy,
    }
    return { ...turn, parts: [...turn.parts, fresh] }
  }
  return {
    ...turn,
    parts: turn.parts.map((p) =>
      p.kind === 'permission' && p.id === requestId
        ? { ...p, state: 'resolved' as const, outcome, resolvedBy }
        : p,
    ),
  }
}

// Dedup against SSE replay — events replay on reconnect, we don't want
// two cards for the same nudge if the user refreshed mid-flow.
function withMcpConnect(turn: ChatTurn, event: StreamedEvent): ChatTurn {
  const toolCallId = String(event.payload.toolCallId ?? '')
  if (turn.parts.some((p) => p.kind === 'mcp-connect' && p.id === toolCallId)) {
    return turn
  }
  const fresh: McpConnectPart = {
    kind: 'mcp-connect',
    id: toolCallId,
    toolkit: String(event.payload.toolkit ?? ''),
    reason: String(event.payload.reason ?? ''),
  }
  return { ...turn, parts: [...turn.parts, fresh] }
}

// acpx-ai-provider's finalizeToolCall puts state.emittedText into
// BOTH tool-call.input AND tool-result.result for codex flows —
// there is no distinct output field, just one accumulating blob
// that interleaves args, a status marker, and (optionally) a
// fenced transcript. Without parsing, the tool card shows the same
// string in Parameters and Result.
//
// Common variants:
//   "<args> (in_progress)tool call: ```sh\n<output>\n```"
//   "<args> (in_progress)tool call (failed): <error>"
//   "<args> (in_progress)tool call (completed)"
//   "<args> (in_progress): <repeated args>...tool call (completed)"
//   "<args> (in_progress)tool calltool calltool call (completed)"
//                       ^ older acpx (≤ 0.6.x) concatenates one
//                       'tool call' per intermediate status event
//                       without separators
//
// Returns null when the marker is absent — that's the anthropic /
// openai-direct flow with a structured tool.call payload; leave it
// alone.
const ACPX_STATUS_MARKER = ' (in_progress)'

// One leading status-header segment: 'tool call' (no space required
// before the next character so the older acpx repetitions match) with
// optional parens for the terminal status ('(completed)', '(failed)',
// …), trailing whitespace, optional colon, more whitespace. Wrapped
// in `(...)+` so the regex eats every concatenated `tool call` in
// one pass.
const ACPX_STATUS_HEADER = /^(tool call\s*(?:\([^)]*\))?\s*:?\s*)+/
// Status-only tail used by the dedupe path below (where the rest
// starts with a repeat of args). Same shape, just non-anchored.
const ACPX_STATUS_TAIL = /^(tool call\b|\s)+$/

function splitAcpxToolBlob(
  s: string,
): { args: string; output: string | null } | null {
  const idx = s.indexOf(ACPX_STATUS_MARKER)
  if (idx < 0) return null
  const args = s.slice(0, idx).trim()
  let rest = s.slice(idx + ACPX_STATUS_MARKER.length)
  rest = rest.replace(ACPX_STATUS_HEADER, '').replace(/^:\s*/, '').trim()
  rest = rest
    .replace(/^```\w*\s*\n?/, '')
    .replace(/\n?```\s*$/, '')
    .trim()
  if (!rest || ACPX_STATUS_HEADER.test(rest)) {
    return { args, output: null }
  }
  if (args && rest.startsWith(args)) {
    const tail = rest.slice(args.length).trim()
    if (!tail || ACPX_STATUS_TAIL.test(tail)) {
      return { args, output: null }
    }
  }
  return { args, output: rest }
}

function withToolCall(turn: ChatTurn, event: StreamedEvent): ChatTurn {
  const toolCallId = String(event.payload.toolCallId ?? '')
  const toolName = String(event.payload.toolName ?? '')
  if (turn.parts.some((p) => p.kind === 'tool' && p.id === toolCallId)) {
    return turn
  }
  // Split codex blobs early so the initial Parameters render shows
  // just the command; tool.result will land later with the same
  // blob and re-split for the output portion.
  const rawInput = event.payload.input
  const split =
    typeof rawInput === 'string' ? splitAcpxToolBlob(rawInput) : null
  const fresh: ToolPart = {
    kind: 'tool',
    id: toolCallId,
    toolName,
    input: split ? split.args : rawInput,
    state: 'input-available',
  }
  return { ...turn, parts: [...turn.parts, fresh] }
}

function withApprovalRequested(turn: ChatTurn, event: StreamedEvent): ChatTurn {
  const toolCallId = String(event.payload.toolCallId ?? '')
  const approvalId = String(event.payload.approvalId ?? '')
  return {
    ...turn,
    parts: turn.parts.map((p) =>
      p.kind === 'tool' && p.id === toolCallId
        ? { ...p, approvalId, state: 'approval-requested' }
        : p,
    ),
  }
}

function withToolResult(turn: ChatTurn, event: StreamedEvent): ChatTurn {
  const toolCallId = String(event.payload.toolCallId ?? '')
  const isError = Boolean(event.payload.isError)
  const rawOutput = event.payload.output
  return {
    ...turn,
    parts: turn.parts.map((p) => {
      if (p.kind !== 'tool' || p.id !== toolCallId) return p
      // Codex flow: result is the same blob as input. Re-split to
      // restore clean args in input + the transcript in output.
      // Anthropic / openai-direct flow: no marker, pass output
      // through but null it if it happens to duplicate input
      // verbatim (defensive — shouldn't normally happen).
      const split =
        typeof rawOutput === 'string' ? splitAcpxToolBlob(rawOutput) : null
      const nextInput = split ? split.args : p.input
      const nextOutput = split
        ? split.output
        : typeof rawOutput === 'string' &&
            typeof p.input === 'string' &&
            rawOutput === p.input
          ? null
          : rawOutput
      return {
        ...p,
        input: nextInput,
        output: nextOutput,
        isError,
        state: isError ? 'output-error' : 'output-available',
      }
    }),
  }
}

export interface UseThreadEventStream {
  history: ChatTurn[]
  live: ChatTurn | null
  // Rolling metrics for the EmployeeBusy footer. Null whenever no turn
  // is in flight; populated for the lifetime of the live turn. Cleared
  // alongside `live` on turn.end / turn.cancel / error.
  activeAssistant: ActiveAssistant | null
}

/**
 * Opens an EventSource against /threads/:id/events, replays history then
 * attaches live updates. Returns the conversation as `history`
 * (finalized turns) plus an optional `live` turn that is mid-stream.
 *
 * The same reducer drives both — the SSE endpoint replays persisted
 * events from the events table before forwarding live ones, so the
 * renderer never has to swap between two render paths.
 */
// Kinds that change the rail's per-employee aggregate status.
// text.delta + tool.call.proposed + tool.result are all included so the
// pending → working transition catches on the first piece of output —
// some turns are tool-only and never emit text.delta, and without the
// tool kinds here the avatar would stay pending for the whole turn.
// The THROTTLE_MS gate below stops streaming bursts from spamming
// refetches.
const RAIL_STATUS_AFFECTING_KINDS: ReadonlySet<EventKind> = new Set<EventKind>([
  'turn.start',
  'text.delta',
  'tool.call.proposed',
  'tool.result',
  'turn.end',
  'turn.cancel',
  'error',
])
const RAIL_INVALIDATE_THROTTLE_MS = 1000

export function useThreadEventStream(threadId: string): UseThreadEventStream {
  const [state, dispatch] = useReducer(reduce, INITIAL_STATE)
  // Coalescing buffer: events arrive on the EventSource microtask queue
  // one at a time, but the reducer only needs to fire once per frame.
  // The buffer is flushed inside requestAnimationFrame so React commits
  // at most 60 times per second no matter how fast the model streams.
  const pending = useRef<StreamedEvent[]>([])
  const rafId = useRef<number | null>(null)
  // Throttle key for the rail invalidation. Without this, every RAF flush
  // during a streaming turn would refetch /employees/with-recent-threads
  // at 60Hz. 1s feels right — well under the user's "wait, did anything
  // happen" threshold, well above the refetch cost.
  const lastRailInvalidatedAt = useRef(0)

  useEffect(() => {
    dispatch({ type: 'reset' })
    pending.current = []
    lastRailInvalidatedAt.current = 0
    if (rafId.current !== null) {
      cancelAnimationFrame(rafId.current)
      rafId.current = null
    }
    const url = `${API_BASE_URL}/threads/${encodeURIComponent(threadId)}/events`
    const source = new EventSource(url)
    const flush = () => {
      rafId.current = null
      if (pending.current.length === 0) return
      const batch = pending.current
      pending.current = []
      dispatch({ type: 'events', events: batch })
      // Refresh the rail's per-employee status when the batch contained
      // a status-affecting event. Throttled so a streaming turn doesn't
      // pin the network to 60 refetches/sec.
      if (batch.some((e) => RAIL_STATUS_AFFECTING_KINDS.has(e.kind))) {
        const now = Date.now()
        if (
          now - lastRailInvalidatedAt.current >=
          RAIL_INVALIDATE_THROTTLE_MS
        ) {
          lastRailInvalidatedAt.current = now
          queryClient.invalidateQueries({
            queryKey: useEmployeesWithRecentThreads.getKey(),
          })
        }
      }
    }
    const handler = (e: MessageEvent) => {
      try {
        const parsed = JSON.parse(e.data) as StreamedEvent
        if (parsed.kind === 'thread.title_changed') {
          applyTitleChange(parsed.payload as unknown as ThreadTitlePayload)
          return
        }
        pending.current.push(parsed)
        if (rafId.current === null) {
          rafId.current = requestAnimationFrame(flush)
        }
      } catch {
        // Malformed event — ignore; the next valid one will resync.
      }
    }
    for (const kind of EVENT_KINDS) source.addEventListener(kind, handler)
    return () => {
      for (const kind of EVENT_KINDS) source.removeEventListener(kind, handler)
      source.close()
      if (rafId.current !== null) {
        cancelAnimationFrame(rafId.current)
        rafId.current = null
      }
      pending.current = []
    }
  }, [threadId])

  return {
    history: state.history,
    live: state.live,
    activeAssistant: state.activeAssistant,
  }
}
