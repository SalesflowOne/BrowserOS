import { integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { channels } from './channels.sql.js'
import { employees } from './employees.sql.js'

export const channelMembers = sqliteTable(
  'channel_members',
  {
    channelId: text('channel_id')
      .notNull()
      .references(() => channels.id, { onDelete: 'cascade' }),
    employeeId: text('employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'cascade' }),
    addedAt: integer('added_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.channelId, t.employeeId] })],
)

export type ChannelMember = typeof channelMembers.$inferSelect
export type NewChannelMember = typeof channelMembers.$inferInsert
