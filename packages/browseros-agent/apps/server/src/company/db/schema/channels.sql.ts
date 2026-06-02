import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { employees } from './employees.sql.js'

export const channels = sqliteTable('channels', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
  topic: text('topic'),
  // The default recipient when the founder posts without an @-mention.
  // Must always be a current member of the channel — enforced at the
  // application layer (the lead PATCH route + the member-remove path
  // both validate against the membership join).
  leadEmployeeId: text('lead_employee_id')
    .notNull()
    .references(() => employees.id),
  // 'user' sentinel or an employee id — same pattern as the rest of
  // the schema (managerId, threads.createdByParticipantId, etc.).
  createdByParticipantId: text('created_by_participant_id').notNull(),
  // Soft delete: archived channels disappear from the rail but their
  // transcripts stay addressable for history / search later.
  archivedAt: integer('archived_at', { mode: 'timestamp_ms' }),
  // Tab group inside the shared app BrowserOS window. Same model as
  // employees.tabGroupId — created at channel create time, injected
  // into MCP tool calls via X-BrowserOS-Default-Tab-Group-Id so any
  // page opened on behalf of this channel lands in the channel's
  // group. Null until bootstrap completes.
  tabGroupId: text('tab_group_id'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
})

export type Channel = typeof channels.$inferSelect
export type NewChannel = typeof channels.$inferInsert
