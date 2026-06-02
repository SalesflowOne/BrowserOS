import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core'
import { telegramConnections } from './telegram_connections.sql.js'
import { threads } from './threads.sql.js'

export const TELEGRAM_CHAT_KINDS = [
  'private',
  'group',
  'supergroup',
  'channel',
] as const
export type TelegramChatKind = (typeof TELEGRAM_CHAT_KINDS)[number]

// Mapping table — one row per (connection, telegram chat id, thread).
// Many rows per (connection, telegram chat id) are allowed: a Telegram
// chat can hold multiple threads on the same employee, switched via
// /switch / /new. `telegram_active_chat` tracks which one is currently
// receiving inbound messages.
//
// A thread can only ever be in one Telegram chat — enforced by the
// unique index on `thread_id`.
export const telegramChats = sqliteTable(
  'telegram_chats',
  {
    id: text('id').primaryKey(),
    connectionId: text('connection_id')
      .notNull()
      .references(() => telegramConnections.id, { onDelete: 'cascade' }),
    telegramChatId: text('telegram_chat_id').notNull(),
    chatKind: text('chat_kind', { enum: TELEGRAM_CHAT_KINDS }).notNull(),
    chatTitle: text('chat_title'),
    threadId: text('thread_id')
      .notNull()
      .references(() => threads.id, { onDelete: 'cascade' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => ({
    connTgChat: index('telegram_chats_conn_tg_chat').on(
      t.connectionId,
      t.telegramChatId,
    ),
    threadUnique: uniqueIndex('telegram_chats_thread_unique').on(t.threadId),
  }),
)

export type TelegramChat = typeof telegramChats.$inferSelect
export type NewTelegramChat = typeof telegramChats.$inferInsert
