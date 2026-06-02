import {
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core'
import { employees } from './employees.sql.js'

export const TELEGRAM_CONNECTION_STATUSES = [
  'active',
  'paused',
  'error',
] as const
export type TelegramConnectionStatus =
  (typeof TELEGRAM_CONNECTION_STATUSES)[number]

// One Telegram bot pinned to one employee. The agent / model / workspace
// tuple is NOT duplicated here — it lives on the employee row and is
// read on every inbound turn. Mutating the employee's tuple changes the
// bot's behaviour automatically; single source of truth.
//
// `botTokenEncrypted` is wrapped via main/telegram/secrets.ts (electron
// safeStorage). `lastError` is the most recent runtime error string —
// surfaced on the Settings → Mobile card.
export const telegramConnections = sqliteTable(
  'telegram_connections',
  {
    id: text('id').primaryKey(),
    employeeId: text('employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    botUsername: text('bot_username'),
    botTokenEncrypted: text('bot_token_encrypted').notNull(),
    status: text('status', { enum: TELEGRAM_CONNECTION_STATUSES })
      .notNull()
      .default('active'),
    lastError: text('last_error'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => ({
    // At most one bot per employee — firing an employee tears the bot
    // down via the FK cascade.
    employeeUnique: uniqueIndex('telegram_connections_employee_unique').on(
      t.employeeId,
    ),
  }),
)

export type TelegramConnection = typeof telegramConnections.$inferSelect
export type NewTelegramConnection = typeof telegramConnections.$inferInsert
