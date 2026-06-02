import type { ChatEvent } from '../../db/schema/events.sql.js'
import { telegramChats } from '../../db/schema/telegram_chats.sql.js'
import { getEventBus } from '../chat/eventBus.js'
import type { TextEndPayload, TurnStartPayload } from '../chat/events.types.js'
import { getDb } from '../db-singleton.js'
import { getTelegramManager } from './manager.js'

// Mirrors desktop-originated chat activity into the Telegram chat that
// is mapped to the same thread. The bridge already streams Telegram-
// originated turns back to the same chat (via forwarder.ts), so this
// subscriber checks `isThreadTelegramOriginated(threadId)` and skips
// in that direction to avoid double-posting.
//
// One subscriber per (threadId, connectionId, telegramChatId) mapping,
// rebuilt on boot from telegram_chats and incrementally attached when
// the bridge creates a new mapping at first-message-in-chat or /new.
class OutboundMirror {
  private readonly attached = new Map<string, () => void>()

  async startAll(): Promise<void> {
    const rows = await getDb().select().from(telegramChats).all()
    for (const row of rows) {
      this.attach(row.connectionId, row.telegramChatId, row.threadId)
    }
  }

  attach(connectionId: string, telegramChatId: string, threadId: string): void {
    if (this.attached.has(threadId)) return
    const unsubscribe = getEventBus().subscribe(threadId, (event) => {
      this.forward(event, connectionId, telegramChatId, threadId)
    })
    this.attached.set(threadId, unsubscribe)
  }

  detach(threadId: string): void {
    const unsubscribe = this.attached.get(threadId)
    if (!unsubscribe) return
    unsubscribe()
    this.attached.delete(threadId)
  }

  stopAll(): void {
    for (const unsubscribe of this.attached.values()) unsubscribe()
    this.attached.clear()
  }

  private forward(
    event: ChatEvent,
    connectionId: string,
    telegramChatId: string,
    threadId: string,
  ): void {
    if (getTelegramManager().isThreadTelegramOriginated(threadId)) return
    const tgThread = getTelegramManager().getThread(
      connectionId,
      telegramChatId,
    )
    if (!tgThread) return

    if (event.kind === 'turn.start') {
      const payload = safeParse<TurnStartPayload>(event.payload)
      const userText = payload?.userMessage?.trim()
      if (userText) void tgThread.post(`_from desktop_\n> ${userText}`)
      return
    }
    if (event.kind === 'text.end') {
      const payload = safeParse<TextEndPayload>(event.payload)
      if (!payload || payload.reasoning) return
      const text = payload.text?.trim()
      if (text) void tgThread.post(text)
      return
    }
  }
}

let _instance: OutboundMirror | null = null

export function getOutboundMirror(): OutboundMirror {
  if (!_instance) _instance = new OutboundMirror()
  return _instance
}

function safeParse<T>(payload: string): T | null {
  try {
    return JSON.parse(payload) as T
  } catch {
    return null
  }
}
