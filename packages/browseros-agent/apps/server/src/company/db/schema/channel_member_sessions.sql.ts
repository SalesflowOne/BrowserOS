import { integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { channels } from './channels.sql.js'
import { employees } from './employees.sql.js'

// Per-(channel, employee) state the orchestrator uses to ship delta
// context per turn. The acpx session id lets the underlying ACP
// child resume native session memory across app restarts; the two
// cursors decide what we replay into the model each wake-up.
export const channelMemberSessions = sqliteTable(
  'channel_member_sessions',
  {
    channelId: text('channel_id')
      .notNull()
      .references(() => channels.id, { onDelete: 'cascade' }),
    employeeId: text('employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'cascade' }),
    // ms-epoch cursor: the orchestrator queries
    // `messages WHERE surface='channel' AND surface_id=? AND created_at > ?`
    // for the delta to replay into the model. 0 = never seen anything
    // (matches every real message on first wake). Sub-millisecond
    // collisions are theoretically possible but practically rare given
    // serial drainage — a `seq` column can be added later if it bites.
    lastSeenAt: integer('last_seen_at').notNull().default(0),
    // Most recent ./SOUL.md mtime (ms since epoch) this session was
    // primed with. On every wake we re-stat SOUL.md; if newer we
    // prepend a 're-read your SOUL.md' nudge to the delta block.
    soulMtimeSeen: integer('soul_mtime_seen').notNull().default(0),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.channelId, t.employeeId] })],
)

export type ChannelMemberSession = typeof channelMemberSessions.$inferSelect
export type NewChannelMemberSession = typeof channelMemberSessions.$inferInsert
