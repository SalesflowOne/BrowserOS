import type { ProtocolEvent } from './events.types.js'
import { isNudgeToolName } from './nudges.js'

// Translates AI SDK streamText parts into our ProtocolEvent shape.
// Per-turn segment accumulators coalesce *delta parts into a single
// *end event with the assembled text — same pattern the reference uses.

interface StreamPartShape {
  type: string
  id?: string
  delta?: string
  text?: string
  toolCallId?: string
  toolName?: string
  input?: unknown
  output?: unknown
  isError?: boolean
  finishReason?: string
  usage?: { inputTokens?: number; outputTokens?: number }
}

function readShape(part: unknown): StreamPartShape {
  if (typeof part !== 'object' || part === null) return { type: 'unknown' }
  const o = part as Record<string, unknown>
  return {
    type: typeof o.type === 'string' ? o.type : 'unknown',
    id: typeof o.id === 'string' ? o.id : undefined,
    delta: typeof o.delta === 'string' ? o.delta : undefined,
    text: typeof o.text === 'string' ? o.text : undefined,
    toolCallId: typeof o.toolCallId === 'string' ? o.toolCallId : undefined,
    toolName: typeof o.toolName === 'string' ? o.toolName : undefined,
    input: o.input,
    output: o.output,
    isError: typeof o.isError === 'boolean' ? o.isError : undefined,
    finishReason:
      typeof o.finishReason === 'string' ? o.finishReason : undefined,
    usage:
      typeof o.usage === 'object' && o.usage !== null
        ? (o.usage as { inputTokens?: number; outputTokens?: number })
        : undefined,
  }
}

class SegmentBuffer {
  private readonly segments = new Map<string, string>()

  append(id: string, chunk: string): void {
    this.segments.set(id, (this.segments.get(id) ?? '') + chunk)
  }

  flush(id: string): string {
    const text = this.segments.get(id) ?? ''
    this.segments.delete(id)
    return text
  }
}

export class StreamTranslator {
  private readonly text = new SegmentBuffer()
  private readonly reasoning = new SegmentBuffer()
  // Aggregate the whole turn's assistant text — written to messages.body
  // alongside the turn.end event in one transaction.
  private aggregateText = ''

  constructor(private readonly requestId: string) {}

  get aggregate(): string {
    return this.aggregateText
  }

  // Translates one stream part. Returns 0..N protocol events.
  translate(part: unknown): ProtocolEvent[] {
    const s = readShape(part)
    if (s.type === 'text-delta') return this.onTextDelta(s)
    if (s.type === 'text-end') return this.onTextEnd(s)
    if (s.type === 'reasoning-delta') return this.onReasoningDelta(s)
    if (s.type === 'reasoning-end') return this.onReasoningEnd(s)
    if (s.type === 'tool-call') return this.onToolCall(s)
    if (s.type === 'tool-result') return this.onToolResult(s)
    // 'text-start' / 'reasoning-start' / 'start' / 'finish' / 'finish-step' / 'raw' etc.
    // — caller handles 'finish' explicitly via aggregate getter on turn end.
    return []
  }

  private onTextDelta(s: StreamPartShape): ProtocolEvent[] {
    // AI SDK v6's `fullStream` exposes the chunk text on `.text`; older v5
    // providers used `.delta`. Accept either so we don't silently drop chunks.
    const chunk = s.text ?? s.delta
    if (!s.id || !chunk) return []
    this.text.append(s.id, chunk)
    this.aggregateText += chunk
    return [
      {
        type: 'text.delta',
        payload: { requestId: this.requestId, blockId: s.id, text: chunk },
      },
    ]
  }

  private onTextEnd(s: StreamPartShape): ProtocolEvent[] {
    if (!s.id) return []
    return [
      {
        type: 'text.end',
        payload: {
          requestId: this.requestId,
          blockId: s.id,
          text: this.text.flush(s.id),
        },
      },
    ]
  }

  private onReasoningDelta(s: StreamPartShape): ProtocolEvent[] {
    const chunk = s.text ?? s.delta
    if (!s.id || !chunk) return []
    this.reasoning.append(s.id, chunk)
    return [
      {
        type: 'text.delta',
        payload: {
          requestId: this.requestId,
          blockId: s.id,
          text: chunk,
          reasoning: true,
        },
      },
    ]
  }

  private onReasoningEnd(s: StreamPartShape): ProtocolEvent[] {
    if (!s.id) return []
    return [
      {
        type: 'text.end',
        payload: {
          requestId: this.requestId,
          blockId: s.id,
          text: this.reasoning.flush(s.id),
          reasoning: true,
        },
      },
    ]
  }

  private onToolCall(s: StreamPartShape): ProtocolEvent[] {
    if (!s.toolCallId || !s.toolName) return []
    // Nudge tools are surfaced via mcp.connect_required on the result;
    // suppress the upstream proposed event so the renderer doesn't
    // briefly show a generic tool block before the card replaces it.
    if (isNudgeToolName(s.toolName)) return []
    return [
      {
        type: 'tool.call.proposed',
        payload: {
          requestId: this.requestId,
          toolCallId: s.toolCallId,
          toolName: s.toolName,
          input: s.input,
        },
      },
    ]
  }

  private onToolResult(s: StreamPartShape): ProtocolEvent[] {
    if (!s.toolCallId || !s.toolName) return []
    // Nudge tools emit their own `mcp.connect_required` event from the
    // handler (see main/routes/nudge-mcp.ts). Swallow the corresponding
    // upstream tool.result here so the renderer doesn't double-render a
    // generic tool block next to the connect card.
    if (isNudgeToolName(s.toolName)) return []
    return [
      {
        type: 'tool.result',
        payload: {
          requestId: this.requestId,
          toolCallId: s.toolCallId,
          toolName: s.toolName,
          output: s.output,
          isError: s.isError,
        },
      },
    ]
  }
}
