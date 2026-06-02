import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const approvals = sqliteTable('approvals', {
  id: text('id').primaryKey(),
  surface: text('surface', { enum: ['thread'] }).notNull(),
  surfaceId: text('surface_id').notNull(),
  proposerEmployeeId: text('proposer_employee_id').notNull(),
  permissionId: text('permission_id').notNull(),
  toolName: text('tool_name').notNull(),
  // Links this approval to the specific tool-call event in the chat
  // stream. The renderer joins on this to surface Approve / Reject
  // inline next to the tool card the agent proposed. Nullable so
  // historical or out-of-band approvals still load cleanly.
  toolCallId: text('tool_call_id'),
  // JSON blob — the raw tool arguments the agent wants to invoke with.
  toolInput: text('tool_input').notNull().default('{}'),
  // JSON array of { deciderId, status, decidedAt } — delegation chain.
  // Resolution at the leaf bubbles up until it lands on 'user' or an
  // intermediate node with alwaysAllow for this permission.
  chain: text('chain').notNull().default('[]'),
  currentDeciderId: text('current_decider_id').notNull(),
  status: text('status', {
    enum: ['pending', 'approved', 'rejected', 'cancelled'],
  })
    .notNull()
    .default('pending'),
  // Human-readable summary surfaced in the approval card.
  title: text('title').notNull(),
  detail: text('detail').notNull(),
  // Optional preview payload — the email body, tweet thread, calendar move,
  // etc. Rendered as a <pre> in the card.
  payload: text('payload'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  resolvedAt: integer('resolved_at', { mode: 'timestamp_ms' }),
})

export type Approval = typeof approvals.$inferSelect
export type NewApproval = typeof approvals.$inferInsert
