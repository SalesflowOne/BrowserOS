import type { TelegramRawMessage } from '@chat-adapter/telegram'
import type { Message } from 'chat'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { type Employee, employees } from '../../db/schema/employees.sql.js'
import { telegramActiveChat } from '../../db/schema/telegram_active_chat.sql.js'
import { telegramChats } from '../../db/schema/telegram_chats.sql.js'
import type { TelegramConnection } from '../../db/schema/telegram_connections.sql.js'
import { type Thread, threads } from '../../db/schema/threads.sql.js'
import { getDb } from '../db-singleton.js'
import { getOutboundMirror } from './outbound-mirror.js'

// chat-sdk's handler signatures expose Message<unknown>; the Telegram
// adapter fills the `raw` slot with a TelegramRawMessage. Narrow once
// at the boundary so the rest of the telegram modules see typed
// chat / author metadata.
export type TelegramMessageLike = Omit<Message, 'raw'> & {
  raw: TelegramRawMessage
}

export const REASONING_EFFORTS = ['none', 'low', 'medium', 'high'] as const
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number]

interface CreateThreadForChatArgs {
  connection: TelegramConnection
  employee: Employee
  telegramChatId: string
  message: TelegramMessageLike
  title: string
}

export async function createThreadForChat(
  args: CreateThreadForChatArgs,
): Promise<string> {
  const db = getDb()
  const now = new Date()
  const threadId = nanoid()
  const row: Thread = {
    id: threadId,
    employeeId: args.employee.id,
    title: args.title,
    isGeneral: false,
    parentThreadId: null,
    createdByParticipantId: 'user',
    status: 'idle',
    acpxSessionId: null,
    agentKindOverride: null,
    modelIdOverride: null,
    reasoningEffortOverride: null,
    workspacePathOverride: null,
    // Telegram threads run unattended — there's no Approve / Deny UI
    // reachable from the chat client. Force read-only so writes auto-
    // deny rather than hanging on a card no human will see.
    permissionMode: 'read-only',
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    lastSeenAt: null,
  }
  await db.insert(threads).values(row)
  await db.insert(telegramChats).values({
    id: nanoid(),
    connectionId: args.connection.id,
    telegramChatId: args.telegramChatId,
    chatKind: args.message.raw.chat.type,
    chatTitle: chatDisplayTitle(args.message),
    threadId,
    createdAt: now,
    updatedAt: now,
  })
  // Attach the outbound mirror so desktop-typed turns on this thread
  // also surface in the Telegram chat. Telegram-originated turns are
  // skipped via the manager's isThreadTelegramOriginated flag set by
  // the bridge around `session.send`.
  getOutboundMirror().attach(args.connection.id, args.telegramChatId, threadId)
  return threadId
}

export async function setActiveThread(
  connectionId: string,
  telegramChatId: string,
  threadId: string,
): Promise<void> {
  const now = new Date()
  await getDb()
    .insert(telegramActiveChat)
    .values({ connectionId, telegramChatId, threadId, updatedAt: now })
    .onConflictDoUpdate({
      target: [
        telegramActiveChat.connectionId,
        telegramActiveChat.telegramChatId,
      ],
      set: { threadId, updatedAt: now },
    })
}

export async function loadActiveThread(
  connectionId: string,
  telegramChatId: string,
): Promise<Thread | null> {
  const db = getDb()
  const active = await db
    .select()
    .from(telegramActiveChat)
    .where(
      and(
        eq(telegramActiveChat.connectionId, connectionId),
        eq(telegramActiveChat.telegramChatId, telegramChatId),
      ),
    )
    .get()
  if (!active) return null
  const row = await db
    .select()
    .from(threads)
    .where(eq(threads.id, active.threadId))
    .get()
  return row ?? null
}

// Chat-scoped recent threads: only threads ever seen in THIS Telegram
// chat (via telegram_chats). Capped at 5 per the Phase 1 plan to keep
// /list and /switch noise-free; user can rely on /new to start fresh
// once the list ages out.
export async function listRecentThreads(
  connectionId: string,
  telegramChatId: string,
): Promise<Thread[]> {
  return getDb()
    .select({
      id: threads.id,
      employeeId: threads.employeeId,
      title: threads.title,
      isGeneral: threads.isGeneral,
      parentThreadId: threads.parentThreadId,
      createdByParticipantId: threads.createdByParticipantId,
      status: threads.status,
      acpxSessionId: threads.acpxSessionId,
      agentKindOverride: threads.agentKindOverride,
      modelIdOverride: threads.modelIdOverride,
      reasoningEffortOverride: threads.reasoningEffortOverride,
      workspacePathOverride: threads.workspacePathOverride,
      permissionMode: threads.permissionMode,
      createdAt: threads.createdAt,
      updatedAt: threads.updatedAt,
      archivedAt: threads.archivedAt,
      lastSeenAt: threads.lastSeenAt,
    })
    .from(telegramChats)
    .innerJoin(threads, eq(threads.id, telegramChats.threadId))
    .where(
      and(
        eq(telegramChats.connectionId, connectionId),
        eq(telegramChats.telegramChatId, telegramChatId),
        isNull(threads.archivedAt),
      ),
    )
    .orderBy(desc(threads.updatedAt))
    .limit(5)
}

export async function loadEmployee(
  employeeId: string,
): Promise<Employee | null> {
  const row = await getDb()
    .select()
    .from(employees)
    .where(eq(employees.id, employeeId))
    .get()
  return row ?? null
}

export function trimTitle(text: string): string {
  const cleaned = text.replace(/\s+/g, ' ').trim()
  if (cleaned.length <= 80) return cleaned
  return `${cleaned.slice(0, 77)}…`
}

function chatDisplayTitle(message: TelegramMessageLike): string | null {
  const chat = message.raw.chat
  if (chat.type === 'private') {
    return message.author?.fullName || chat.username || null
  }
  return chat.title ?? null
}
