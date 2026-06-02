import type { Thread } from 'chat'
import type { ChatEvent } from '../../db/schema/events.sql.js'
import { getEventBus } from '../chat/eventBus.js'
import type {
  ErrorEventPayload,
  McpConnectRequiredPayload,
  TextEndPayload,
} from '../chat/events.types.js'

// Subscribes to the chat event bus for one thread and posts assistant
// output back to the bound Telegram thread. Lifetime is managed by the
// caller (bridge): start before invoking `ChatSession.send`, stop in a
// `finally` once `send` returns. ChatSession is single-flight per
// thread, so all events that arrive between start and stop belong to
// this turn — no requestId filtering needed.
//
// Phase 1 forwards `text.end` blocks (assistant final text), terminal
// `turn.cancel` / `error`, and `mcp.connect_required` cards. `tool.*`
// indicators and per-delta streaming are deferred — text.end is the
// agent's full reply for the block.
export function attachForwarder(
  threadId: string,
  tgThread: Thread,
): () => void {
  return getEventBus().subscribe(threadId, (event: ChatEvent) => {
    forwardEvent(event, tgThread)
  })
}

function forwardEvent(event: ChatEvent, tgThread: Thread): void {
  if (event.kind === 'text.end') {
    const payload = safeParse<TextEndPayload>(event.payload)
    if (!payload || payload.reasoning) return
    const text = payload.text?.trim()
    if (text) void tgThread.post(text)
    return
  }
  if (event.kind === 'mcp.connect_required') {
    const payload = safeParse<McpConnectRequiredPayload>(event.payload)
    const toolkit = payload?.toolkit ?? 'service'
    const reason = payload?.reason ?? 'authorization required'
    void tgThread.post(
      `🔌 Connect ${toolkit} to continue: ${reason}\nOpen the desktop app to authorize, then retry.`,
    )
    return
  }
  if (event.kind === 'turn.cancel') {
    void tgThread.post('Cancelled.')
    return
  }
  if (event.kind === 'error') {
    const payload = safeParse<ErrorEventPayload>(event.payload)
    void tgThread.post(`❌ ${payload?.message ?? 'unknown error'}`)
    return
  }
}

function safeParse<T>(payload: string): T | null {
  try {
    return JSON.parse(payload) as T
  } catch {
    return null
  }
}
