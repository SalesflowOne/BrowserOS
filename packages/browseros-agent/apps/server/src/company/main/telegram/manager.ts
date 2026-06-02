import {
  createTelegramAdapter,
  type TelegramAdapter,
} from '@chat-adapter/telegram'
import { Chat, type Message, type Thread } from 'chat'
import { eq } from 'drizzle-orm'
import {
  type TelegramConnection,
  telegramConnections,
} from '../../db/schema/telegram_connections.sql.js'
import { getDb } from '../db-singleton.js'
import { decryptSecret } from './secrets.js'
import { MemoryStateAdapter } from './state-adapter.js'

// Inbound-message callback. Injected by the boot wiring (see
// main/index.ts) so the manager doesn't have to import the bridge —
// that direction of import would create a cycle since the bridge
// already imports the manager for the originated-thread flag.
export type TelegramMessageHandler = (
  connection: TelegramConnection,
  thread: Thread,
  message: Message,
) => Promise<void>

type RunningBot = {
  connectionId: string
  chat: Chat<{ telegram: TelegramAdapter }>
  adapter: TelegramAdapter
}

class TelegramManager {
  private readonly bots = new Map<string, RunningBot>()
  private readonly starting = new Map<string, Promise<void>>()
  private onMessage: TelegramMessageHandler | null = null

  // Threads whose current turn was started by an inbound Telegram
  // message. The outbound mirror checks this set when forwarding
  // events: a thread that is mid-Telegram-turn is already being
  // streamed back by the bridge's forwarder, so the mirror skips it.
  // ChatSession is single-flight per thread, so threadId-keyed
  // marking is sufficient — bridge sets the flag before calling
  // `session.send` and clears it after `send` returns.
  private readonly telegramOriginatedThreads = new Set<string>()

  setMessageHandler(handler: TelegramMessageHandler): void {
    this.onMessage = handler
  }

  async startAll(): Promise<void> {
    const rows = await getDb()
      .select()
      .from(telegramConnections)
      .where(eq(telegramConnections.status, 'active'))
      .all()
    await Promise.allSettled(rows.map((r) => this.start(r)))
  }

  async start(connection: TelegramConnection): Promise<void> {
    if (this.bots.has(connection.id)) return
    const existing = this.starting.get(connection.id)
    if (existing) return existing

    const launch = this.doStart(connection).finally(() => {
      this.starting.delete(connection.id)
    })
    this.starting.set(connection.id, launch)
    return launch
  }

  async stop(connectionId: string): Promise<void> {
    const running = this.bots.get(connectionId)
    if (!running) return
    this.bots.delete(connectionId)
    try {
      await running.chat.shutdown()
    } catch (err) {
      logError(connectionId, 'shutdown failed', err)
    }
  }

  async restart(connection: TelegramConnection): Promise<void> {
    await this.stop(connection.id)
    await this.start(connection)
  }

  async stopAll(): Promise<void> {
    const ids = [...this.bots.keys()]
    await Promise.allSettled(ids.map((id) => this.stop(id)))
  }

  getStatus(connectionId: string): 'running' | 'starting' | 'stopped' {
    if (this.bots.has(connectionId)) return 'running'
    if (this.starting.has(connectionId)) return 'starting'
    return 'stopped'
  }

  // Returns a Thread handle for posting outside the inbound handler
  // flow (e.g. mirroring app-typed user messages back to Telegram, or
  // posting approval inline keyboards). Null when the bot for that
  // connection isn't running.
  getThread(connectionId: string, telegramChatId: string): Thread | null {
    const running = this.bots.get(connectionId)
    if (!running) return null
    const threadId = running.adapter.encodeThreadId({
      chatId: telegramChatId,
    })
    return running.chat.thread(threadId)
  }

  markThreadTelegramOriginated(threadId: string): void {
    this.telegramOriginatedThreads.add(threadId)
  }

  clearThreadTelegramOriginated(threadId: string): void {
    this.telegramOriginatedThreads.delete(threadId)
  }

  isThreadTelegramOriginated(threadId: string): boolean {
    return this.telegramOriginatedThreads.has(threadId)
  }

  private async doStart(connection: TelegramConnection): Promise<void> {
    let botToken: string
    try {
      botToken = await decryptSecret(connection.botTokenEncrypted)
    } catch (err) {
      await this.markError(connection.id, errorMessage(err))
      return
    }

    const userName = connection.botUsername ?? 'browserclaw-bot'
    const adapter = createTelegramAdapter({
      botToken,
      mode: 'polling',
      userName,
    })
    const chat = new Chat<{ telegram: TelegramAdapter }>({
      userName,
      adapters: { telegram: adapter },
      state: new MemoryStateAdapter(),
      logger: 'warn',
    })

    // Three entry points → the same bridge:
    //  - onDirectMessage: 1:1 DMs (Telegram private chats)
    //  - onNewMention: a @-mention in a group, first time
    //  - onSubscribedMessage: every follow-up after we subscribe
    // Subscribing in the first two routes follow-ups through
    // onSubscribedMessage, which keeps the agent in the same
    // conversation rather than re-handshaking each turn.
    const dispatch = async (thread: Thread, message: Message) => {
      if (!this.onMessage) {
        logError(
          connection.id,
          'inbound message dropped',
          'no handler registered — bridge boot wiring missing',
        )
        return
      }
      await this.onMessage(connection, thread, message)
    }
    chat.onDirectMessage(async (thread, message) => {
      await thread.subscribe()
      await dispatch(thread, message)
    })
    chat.onNewMention(async (thread, message) => {
      await thread.subscribe()
      await dispatch(thread, message)
    })
    chat.onSubscribedMessage(async (thread, message) => {
      await dispatch(thread, message)
    })

    try {
      await chat.initialize()
    } catch (err) {
      await this.markError(connection.id, errorMessage(err))
      // chat-sdk holds resources even on a failed init — flush them so
      // a retry doesn't leak the previous polling loop.
      try {
        await chat.shutdown()
      } catch {
        // best-effort cleanup
      }
      return
    }

    this.bots.set(connection.id, {
      connectionId: connection.id,
      chat,
      adapter,
    })
    await this.clearError(connection.id)
  }

  private async markError(
    connectionId: string,
    message: string,
  ): Promise<void> {
    await getDb()
      .update(telegramConnections)
      .set({ status: 'error', lastError: message, updatedAt: new Date() })
      .where(eq(telegramConnections.id, connectionId))
      .run()
    logError(connectionId, 'bot startup failed', message)
  }

  private async clearError(connectionId: string): Promise<void> {
    // Also reset status to 'active' — startAll filters on status,
    // so leaving a previously-errored row at status='error' would
    // make the next boot skip a connection the user already healed
    // via Restart.
    await getDb()
      .update(telegramConnections)
      .set({ status: 'active', lastError: null, updatedAt: new Date() })
      .where(eq(telegramConnections.id, connectionId))
      .run()
  }
}

let instance: TelegramManager | null = null

export function getTelegramManager(): TelegramManager {
  if (!instance) instance = new TelegramManager()
  return instance
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}

function logError(connectionId: string, label: string, err: unknown): void {
  // biome-ignore lint/suspicious/noConsole: surface bot-startup / shutdown failures once at the main process
  console.error(`[telegram:${connectionId}] ${label}:`, err)
}
