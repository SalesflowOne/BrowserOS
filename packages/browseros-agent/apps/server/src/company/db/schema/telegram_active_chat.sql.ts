import { integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { telegramConnections } from './telegram_connections.sql.js'
import { threads } from './threads.sql.js'

// Active-thread pointer per (connection, telegram chat id). Composite
// primary key enforces "exactly one active thread at a time" for each
// Telegram chat. Inbound messages route to this thread; /switch upserts
// a new threadId; /new creates a fresh thread and points here.
export const telegramActiveChat = sqliteTable(
  'telegram_active_chat',
  {
    connectionId: text('connection_id')
      .notNull()
      .references(() => telegramConnections.id, { onDelete: 'cascade' }),
    telegramChatId: text('telegram_chat_id').notNull(),
    threadId: text('thread_id')
      .notNull()
      .references(() => threads.id, { onDelete: 'cascade' }),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.connectionId, t.telegramChatId] }),
  }),
)

export type TelegramActiveChat = typeof telegramActiveChat.$inferSelect
export type NewTelegramActiveChat = typeof telegramActiveChat.$inferInsert
