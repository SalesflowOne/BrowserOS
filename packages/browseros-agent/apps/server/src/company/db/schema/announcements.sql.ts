import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { employees } from './employees.sql.js'
import { threads } from './threads.sql.js'

// One row per `post_announcement` MCP call. The agent decides when to
// post; the founder reads. Title and body are raw GitHub-flavoured
// markdown; rendering happens in the view layer via the shared
// MarkdownView wrapper.
export const announcements = sqliteTable(
  'announcements',
  {
    id: text('id').primaryKey(),
    employeeId: text('employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'cascade' }),
    // Optional link back to the chat thread that produced the post.
    // Set when the tool call originates from a thread; null for any
    // direct admin / seed inserts. `set null` so dropping a thread
    // doesn't cascade-delete the historical announcement.
    threadId: text('thread_id').references(() => threads.id, {
      onDelete: 'set null',
    }),
    // Matches the `requestId` carried by the chat events stream for
    // the turn that emitted the tool call. Useful for debugging /
    // cross-referencing without joining the events table.
    turnRequestId: text('turn_request_id'),
    title: text('title').notNull(),
    body: text('body').notNull(),
    postedAt: integer('posted_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [
    index('announcements_posted_at_idx').on(t.postedAt),
    index('announcements_employee_idx').on(t.employeeId),
  ],
)

export type Announcement = typeof announcements.$inferSelect
export type NewAnnouncement = typeof announcements.$inferInsert
