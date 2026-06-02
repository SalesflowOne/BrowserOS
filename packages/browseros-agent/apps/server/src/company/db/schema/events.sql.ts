import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { threads } from './threads.sql.js'

export const events = sqliteTable(
  'events',
  {
    id: text('id').primaryKey(),
    threadId: text('thread_id')
      .notNull()
      .references(() => threads.id, { onDelete: 'cascade' }),
    // Monotonically-increasing cursor per thread. SSE subscribers send
    // `Last-Event-ID` (this value) on reconnect; the server replays from
    // the next seq forward.
    seq: integer('seq').notNull(),
    // 'turn.start' | 'text.delta' | 'tool.call.proposed' | 'tool.result'
    // | 'turn.end' | 'turn.cancel' | 'error'. Discriminator for `payload`.
    kind: text('kind').notNull(),
    payload: text('payload').notNull(),
    ts: integer('ts', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [index('events_thread_seq_idx').on(t.threadId, t.seq)],
)

export type ChatEvent = typeof events.$inferSelect
export type NewChatEvent = typeof events.$inferInsert
