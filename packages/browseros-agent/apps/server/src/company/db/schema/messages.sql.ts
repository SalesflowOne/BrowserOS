import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const messages = sqliteTable(
  'messages',
  {
    id: text('id').primaryKey(),
    // 'channel' rows are written by the channels orchestrator; 'thread'
    // rows by the per-employee thread surface. Same table, two surfaces.
    surface: text('surface', { enum: ['thread', 'channel'] }).notNull(),
    surfaceId: text('surface_id').notNull(),
    // 'user' sentinel or employeeId.
    authorId: text('author_id').notNull(),
    // 'delegate' rows are inter-agent dispatches inside channels — the
    // body is the brief and toParticipantId is the recipient. They post
    // to the channel transcript so everyone sees the routing.
    kind: text('kind', {
      enum: ['text', 'approval', 'system', 'delegate'],
    }).notNull(),
    body: text('body'),
    approvalId: text('approval_id'),
    // Only set for kind='delegate'. Carries the recipient's id so the
    // renderer can prefix the body with `@<name>` and the orchestrator
    // can replay queued turns after restart if we ever persist events.
    toParticipantId: text('to_participant_id'),
    // Streaming lifecycle for v1.2: the orchestrator inserts a row
    // with `status='streaming'` on the first text-delta of a channel
    // turn, throttle-updates the body during streaming, and flips to
    // `'complete'` (or `'error'`) on turn.end. Existing rows + thread
    // surface always pass `'complete'`; the default keeps them stable.
    status: text('status', { enum: ['streaming', 'complete', 'error'] })
      .notNull()
      .default('complete'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [
    index('messages_surface_idx').on(t.surface, t.surfaceId, t.createdAt),
  ],
)

export type Message = typeof messages.$inferSelect
export type NewMessage = typeof messages.$inferInsert
