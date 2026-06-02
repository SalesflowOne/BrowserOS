import type {
  PermissionOutcome,
  PermissionToolKind,
} from '../../shared/permission.js'

// Discriminated union of every event we persist in the `events` table.
// One row per emit. The renderer reconstructs the conversation from
// these — they are the source of truth for the live UI.

export interface TurnStartPayload {
  requestId: string
  userMessage: string
  agentKind: string
  modelId: string | null
}

export interface TextDeltaPayload {
  requestId: string
  blockId: string
  text: string
  reasoning?: boolean
}

export interface TextEndPayload {
  requestId: string
  blockId: string
  text: string
  reasoning?: boolean
}

export interface ToolCallProposedPayload {
  requestId: string
  toolCallId: string
  toolName: string
  input: unknown
}

export interface ToolResultPayload {
  requestId: string
  toolCallId: string
  toolName: string
  output: unknown
  isError?: boolean
}

export interface ToolApprovalRequestedPayload {
  requestId: string
  toolCallId: string
  approvalId: string
}

export interface TurnEndPayload {
  requestId: string
  finishReason: string
  // Aggregated assistant text — copied into messages.body on the same tx.
  text: string
  usage?: {
    inputTokens?: number
    outputTokens?: number
  }
}

export interface TurnCancelPayload {
  requestId: string
  reason: 'user-interrupt' | 'boot-recovery' | 'error'
}

export interface ErrorEventPayload {
  requestId: string | null
  code: string
  message: string
  retryable: boolean
  // Optional extra context (typically the error stack or a sub-cause
  // string). Rendered inside the structured error block under the
  // primary message — useful for surfacing transport-level detail
  // without polluting `message` for short-summary surfaces.
  details?: string
}

// Emitted in place of `tool.result` when the LLM calls a klavis nudge
// tool (today: `suggest_app_connection`). StreamTranslator parses the
// JSON output into this shape so the events table holds the decoded
// payload directly — replay never has to re-parse.
export interface McpConnectRequiredPayload {
  requestId: string
  toolCallId: string
  toolkit: string
  reason: string
}

// Emitted by the in-process browserclaw MCP server when the LLM
// calls `set_thread_title` on a still-default thread. The renderer's
// SSE hook listens for this and patches the cached thread row's title
// in-place so the rail re-renders without a refetch.
export interface ThreadTitleChangedPayload {
  threadId: string
  title: string
}

// Emitted when the agent's onPermissionRequest callback fires and the
// thread's permission mode escalates it to the user. The renderer
// responds via
//   POST /threads/:id/permission/:requestId
// which resolves the pending callback promise and produces a
// matching permission.resolved event.
export interface PermissionRequestPayload {
  requestId: string
  // The turn this permission gate belongs to; lets the renderer keep
  // the card grouped with its turn during transcript replay even when
  // multiple turns interleave.
  turnRequestId: string
  toolCallId: string
  toolName: string
  toolKind: PermissionToolKind | null
  // Best-effort tool input snapshot for the card preview. Optional —
  // the underlying acpx event shape isn't load-bearing here.
  input?: unknown
}

// Emitted after the callback's pending promise resolves — either
// because the user clicked a button (resolvedBy='user'), the current
// mode short-circuited (resolvedBy='auto'), or turn.cancel landed
// while pending (resolvedBy='cancel'). Carries the final outcome so
// the renderer can transition the card from pending → resolved
// without round-tripping the server.
export interface PermissionResolvedPayload {
  requestId: string
  outcome: PermissionOutcome
  resolvedBy: 'user' | 'auto' | 'cancel'
}

// Emitted right after ChatSession.send assembles the ModelMessage[] and
// before streamText begins, so the renderer's EmployeeBusy indicator
// has a token-count anchor for the input cell from the very first
// frame. `approxInputChars` is summed from text content only via
// turn-input-chars.ts; binaries / images are ignored. The value is
// load-bearing for the indicator's "↑ ~N tok" cell. Do NOT use it
// for billing or quota math.
export interface MetaTurnInputPayload {
  requestId: string
  approxInputChars: number
}

export type ProtocolEvent =
  | { type: 'turn.start'; payload: TurnStartPayload }
  | { type: 'text.delta'; payload: TextDeltaPayload }
  | { type: 'text.end'; payload: TextEndPayload }
  | { type: 'tool.call.proposed'; payload: ToolCallProposedPayload }
  | { type: 'tool.result'; payload: ToolResultPayload }
  | { type: 'tool.approval.requested'; payload: ToolApprovalRequestedPayload }
  | { type: 'mcp.connect_required'; payload: McpConnectRequiredPayload }
  | { type: 'thread.title_changed'; payload: ThreadTitleChangedPayload }
  | { type: 'permission.request'; payload: PermissionRequestPayload }
  | { type: 'permission.resolved'; payload: PermissionResolvedPayload }
  | { type: 'meta.turn-input'; payload: MetaTurnInputPayload }
  | { type: 'turn.end'; payload: TurnEndPayload }
  | { type: 'turn.cancel'; payload: TurnCancelPayload }
  | { type: 'error'; payload: ErrorEventPayload }

export type ProtocolEventType = ProtocolEvent['type']
