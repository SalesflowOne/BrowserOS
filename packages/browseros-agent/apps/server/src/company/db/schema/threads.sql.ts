import {
  type AnySQLiteColumn,
  integer,
  sqliteTable,
  text,
} from 'drizzle-orm/sqlite-core'
import { employees } from './employees.sql.js'

export const threads = sqliteTable('threads', {
  id: text('id').primaryKey(),
  employeeId: text('employee_id')
    .notNull()
    .references(() => employees.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  isGeneral: integer('is_general', { mode: 'boolean' })
    .notNull()
    .default(false),
  // For forked threads — the agent splits a tangent off the parent. Null for top-level.
  parentThreadId: text('parent_thread_id').references(
    (): AnySQLiteColumn => threads.id,
    { onDelete: 'set null' },
  ),
  // 'user' sentinel or employeeId.
  createdByParticipantId: text('created_by_participant_id').notNull(),
  status: text('status', {
    enum: ['idle', 'streaming', 'awaiting_approval', 'completed', 'error'],
  })
    .notNull()
    .default('idle'),
  // Persistent ACP session id, written after the first turn. Reopening
  // the thread resumes the same agent context (memory, tool history).
  acpxSessionId: text('acpx_session_id'),
  // Per-thread tuple overrides. Null on each field = use the employee's
  // default. Set when the user picks a different agent / model /
  // workspace / effort from the composer.
  agentKindOverride: text('agent_kind_override'),
  modelIdOverride: text('model_id_override'),
  reasoningEffortOverride: text('reasoning_effort_override'),
  workspacePathOverride: text('workspace_path_override'),
  // Per-thread permission mode for the acpx onPermissionRequest gate.
  // Null = fall back to settings.defaultPermissionMode. Snapshotted at
  // thread create from the current default; mutated thereafter only
  // via the chat-header picker. Bumping the default later does not
  // retroactively touch existing threads.
  permissionMode: text('permission_mode', {
    enum: ['auto-approve-reads', 'manual', 'read-only', 'allow-all'],
  }),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  // Soft-archive timestamp. Null = visible in the rail; non-null = the
  // rail's per-employee + bulk thread reads filter the row out. There's
  // no archive screen yet, so archived rows are effectively hidden until
  // that UI lands.
  archivedAt: integer('archived_at', { mode: 'timestamp_ms' }),
  // Bumped to "now" when the renderer opens the thread (ChatSurface
  // mount → POST /threads/:id/seen). The rail's "attention" state is
  // computed as `max(events.ts for this thread) > lastSeenAt`. Null =
  // never seen — every event counts as unread, so a fresh thread starts
  // in attention the moment its first event lands and clears once the
  // founder opens it.
  lastSeenAt: integer('last_seen_at', { mode: 'timestamp_ms' }),
})

export type Thread = typeof threads.$inferSelect
export type NewThread = typeof threads.$inferInsert

/**
 * Default title given to a thread at creation time when the client
 * doesn't supply one. The auto-title MCP tool + server-side fallback
 * both gate on `title !== DEFAULT_THREAD_TITLE` to decide whether the
 * rail entry is still "fresh enough" to overwrite — so the threads
 * POST handler, browserclaw-mcp.ts, and chat/title-auto.ts all
 * import this same constant. Drift here would silently break the
 * auto-title feature, so it's intentionally single-sourced.
 */
export const DEFAULT_THREAD_TITLE = 'New thread'
