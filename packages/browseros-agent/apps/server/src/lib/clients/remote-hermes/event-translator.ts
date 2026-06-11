/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import type { UIMessageStreamWriter } from 'ai'

export interface WorkerProtocolEvent {
  type: string
  payload: unknown
}

export interface TranslatorOptions {
  messageId?: string
}

/**
 * Stateful translator from agent-runtime-service ProtocolEvent stream to
 * AI SDK UI Message Stream parts. Tracks open text/reasoning blocks so
 * each block emits exactly one start, N deltas, and one end.
 */
export class WorkerEventTranslator {
  private startedBlocks = new Set<string>()
  private didEmitStart = false

  constructor(
    private readonly writer: UIMessageStreamWriter,
    private readonly opts: TranslatorOptions = {},
  ) {}

  handle(event: WorkerProtocolEvent): void {
    const payload = isObject(event.payload) ? event.payload : {}
    switch (event.type) {
      case 'turn.start':
        this.ensureStart()
        return
      case 'text.delta':
        this.onTextDelta(payload)
        return
      case 'text.end':
        this.onTextEnd(payload)
        return
      case 'tool.call.proposed':
        this.onToolCall(payload)
        return
      case 'tool.result':
        this.onToolResult(payload)
        return
      case 'turn.end':
        this.onTurnEnd(payload)
        return
      case 'turn.cancel':
        this.onTurnCancel(payload)
        return
      case 'error':
        this.onError(payload)
        return
      default:
        return
    }
  }

  /** Force-close any open blocks. Safe to call from finalizers / abort handlers. */
  flush(): void {
    for (const id of this.startedBlocks) {
      this.writer.write({ type: 'text-end', id })
    }
    this.startedBlocks.clear()
  }

  private ensureStart(): void {
    if (this.didEmitStart) return
    this.didEmitStart = true
    this.writer.write({
      type: 'start',
      ...(this.opts.messageId ? { messageId: this.opts.messageId } : {}),
    })
  }

  private onTextDelta(p: Record<string, unknown>): void {
    this.ensureStart()
    const blockId = readString(p.blockId)
    const text = readString(p.text)
    if (!blockId || !text) return
    const reasoning = p.reasoning === true
    if (!this.startedBlocks.has(blockId)) {
      this.startedBlocks.add(blockId)
      this.writer.write({
        type: reasoning ? 'reasoning-start' : 'text-start',
        id: blockId,
      })
    }
    this.writer.write({
      type: reasoning ? 'reasoning-delta' : 'text-delta',
      id: blockId,
      delta: text,
    })
  }

  private onTextEnd(p: Record<string, unknown>): void {
    const blockId = readString(p.blockId)
    if (!blockId) return
    const reasoning = p.reasoning === true
    if (!this.startedBlocks.has(blockId)) {
      this.startedBlocks.add(blockId)
      this.writer.write({
        type: reasoning ? 'reasoning-start' : 'text-start',
        id: blockId,
      })
    }
    this.writer.write({
      type: reasoning ? 'reasoning-end' : 'text-end',
      id: blockId,
    })
    this.startedBlocks.delete(blockId)
  }

  private onToolCall(p: Record<string, unknown>): void {
    this.ensureStart()
    const toolCallId = readString(p.toolCallId)
    const toolName = readString(p.toolName)
    if (!toolCallId || !toolName) return
    this.writer.write({
      type: 'tool-input-available',
      toolCallId,
      toolName: stripToolNamespace(toolName),
      input: p.input,
    })
  }

  private onToolResult(p: Record<string, unknown>): void {
    const toolCallId = readString(p.toolCallId)
    if (!toolCallId) return
    const errorText =
      p.isError === true
        ? (readString(extractErrorText(p.output)) ?? 'tool error')
        : undefined
    this.writer.write(
      errorText
        ? { type: 'tool-output-error', toolCallId, errorText }
        : { type: 'tool-output-available', toolCallId, output: p.output },
    )
  }

  private onTurnEnd(p: Record<string, unknown>): void {
    this.flush()
    this.writer.write({
      type: 'finish',
      ...(isObject(p.usage) ? { messageMetadata: { usage: p.usage } } : {}),
    })
  }

  private onTurnCancel(p: Record<string, unknown>): void {
    this.flush()
    this.writer.write({ type: 'abort', reason: readString(p.reason) })
  }

  private onError(p: Record<string, unknown>): void {
    const message = readString(p.message) ?? 'Remote Hermes error'
    this.writer.write({ type: 'error', errorText: message })
  }
}

function readString(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined
}

/**
 * Strip the acpx MCP-server prefix and the VM-side catalog server prefix
 * from a tool name so chat tool cards render the bare BrowserOS tool name.
 *
 * Examples:
 *   "browserclaw-remote__browseros.suggest_schedule"  → "suggest_schedule"
 *   "browseros__browseros.click_at"                   → "click_at"
 *   "browseros_browseros_suggest_app_connection"      → "suggest_app_connection"
 *   "browseros.take_snapshot"                         → "take_snapshot"
 *   "click_at"                                        → "click_at"
 */
export function stripToolNamespace(toolName: string): string {
  let result = toolName

  // Strip acpx's "<mcpServerName>__" prefix (double underscore separator).
  const acpxIdx = result.indexOf('__')
  if (acpxIdx > 0) result = result.slice(acpxIdx + 2)

  // Strip a duplicated "<server>_<server>_" prefix. acpx normalizes the
  // VM catalog's "<server>.<tool>" dot into an underscore when emitting
  // tool names, which collides with our MCP server name (also
  // "browseros") to produce e.g. "browseros_browseros_suggest_schedule".
  // Only strip when the two server segments match exactly so we never
  // chew the head off an unrelated tool that happens to start
  // "browseros_".
  const doubled = result.match(/^([a-z][\w-]*)_\1_/i)
  if (doubled) result = result.slice(doubled[0].length)

  // Strip a residual "<server>." catalog prefix (older format, kept for
  // back-compat with VMs running an earlier image).
  const dotIdx = result.indexOf('.')
  if (dotIdx > 0) {
    const head = result.slice(0, dotIdx)
    if (/^[\w-]+$/.test(head)) result = result.slice(dotIdx + 1)
  }

  return result
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

function extractErrorText(output: unknown): string | undefined {
  if (typeof output === 'string') return output
  if (isObject(output) && typeof output.message === 'string')
    return output.message
  return undefined
}
