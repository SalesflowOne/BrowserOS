import type { Message, Thread as TgThread } from 'chat'
import { and, eq } from 'drizzle-orm'
import type { Employee } from '../../db/schema/employees.sql.js'
import { telegramActiveChat } from '../../db/schema/telegram_active_chat.sql.js'
import type { TelegramConnection } from '../../db/schema/telegram_connections.sql.js'
import type { ChatSession } from '../chat/ChatSession.js'
import { getSessionManager } from '../chat/sessionManager.js'
import type { ChatTuple } from '../chat/tuple.js'
import { getDb } from '../db-singleton.js'
import { handleCommand } from './commands.js'
import { attachForwarder } from './forwarder.js'
import { getTelegramManager } from './manager.js'
import {
  createThreadForChat,
  loadEmployee,
  setActiveThread,
  type TelegramMessageLike,
  trimTitle,
} from './thread-store.js'

// One inbound Telegram message → one ChatSession turn → streamed reply
// back to the Telegram thread. Slash commands short-circuit before any
// turn is started; everything else routes to the active thread for
// this (connection, telegram chat) pair, creating one on the first
// message.
export async function handleIncomingTelegramMessage(
  connection: TelegramConnection,
  tgThread: TgThread,
  rawMessage: Message,
): Promise<void> {
  const message = rawMessage as TelegramMessageLike
  const text = message.text?.trim()
  if (!text) {
    await tgThread.post(
      'I can only handle text messages right now — try typing your request.',
    )
    return
  }

  const telegramChatId = String(message.raw.chat.id)
  const employee = await loadEmployee(connection.employeeId)
  if (!employee) {
    await tgThread.post(
      '⚠️ This bot is bound to an employee that no longer exists. Open the desktop app to reconnect.',
    )
    return
  }

  if (text.startsWith('/')) {
    await handleCommand({
      connection,
      employee,
      tgThread,
      telegramChatId,
      message,
      text,
    })
    return
  }

  const threadId = await resolveActiveThread({
    connection,
    employee,
    telegramChatId,
    message,
    firstUserMessage: text,
  })
  await runTurn({ threadId, employee, text, tgThread })
}

interface RunTurnArgs {
  threadId: string
  employee: Employee
  text: string
  tgThread: TgThread
}

async function runTurn({
  threadId,
  employee,
  text,
  tgThread,
}: RunTurnArgs): Promise<void> {
  let session: ChatSession
  try {
    session = await getSessionManager().getOrStart(threadId)
  } catch (err) {
    await tgThread.post(`❌ Couldn't start session: ${errorMessage(err)}`)
    return
  }

  const tuple: ChatTuple = {
    agentKind: employee.agentKind,
    modelId: employee.modelId,
    workspacePath: employee.workspacePath,
    reasoningEffort: employee.reasoningEffort,
  }

  const detach = attachForwarder(threadId, tgThread)
  const manager = getTelegramManager()
  manager.markThreadTelegramOriginated(threadId)
  try {
    await session.send(text, tuple)
  } catch {
    // Error already surfaced via the `error` / `turn.cancel` event,
    // which the forwarder reposts. Nothing to do here beyond cleanup.
  } finally {
    manager.clearThreadTelegramOriginated(threadId)
    detach()
  }
}

interface ResolveActiveThreadArgs {
  connection: TelegramConnection
  employee: Employee
  telegramChatId: string
  message: TelegramMessageLike
  firstUserMessage: string
}

async function resolveActiveThread(
  args: ResolveActiveThreadArgs,
): Promise<string> {
  const db = getDb()
  const active = await db
    .select()
    .from(telegramActiveChat)
    .where(
      and(
        eq(telegramActiveChat.connectionId, args.connection.id),
        eq(telegramActiveChat.telegramChatId, args.telegramChatId),
      ),
    )
    .get()
  if (active) return active.threadId

  // First message in this Telegram chat — create the thread, the
  // mapping row, and the active pointer in one logical step.
  const title = trimTitle(args.firstUserMessage)
  const threadId = await createThreadForChat({
    connection: args.connection,
    employee: args.employee,
    telegramChatId: args.telegramChatId,
    message: args.message,
    title,
  })
  await setActiveThread(args.connection.id, args.telegramChatId, threadId)
  return threadId
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}
