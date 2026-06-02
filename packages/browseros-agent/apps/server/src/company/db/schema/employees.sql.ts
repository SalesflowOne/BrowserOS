import {
  type AnySQLiteColumn,
  integer,
  sqliteTable,
  text,
} from 'drizzle-orm/sqlite-core'

export const employees = sqliteTable('employees', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  role: text('role').notNull(),
  tagline: text('tagline'),
  monogram: text('monogram').notNull(),
  tint: text('tint').notNull(),
  bio: text('bio'),
  status: text('status', {
    enum: ['idle', 'working', 'awaiting_approval', 'offline', 'error'],
  })
    .notNull()
    .default('idle'),
  // Self-FK: an employee's manager is another employee, or null when the
  // founder ('user') manages them directly. The string literal `'user'` is
  // a sentinel handled at the application layer; only employee ids are
  // enforced by this column.
  managerId: text('manager_id').references((): AnySQLiteColumn => employees.id),
  // Who created this row. Null for founder-created (the seed) and the
  // first manual hire; populated when an agent hires another agent on the
  // founder's behalf (delegation tree).
  createdByEmployeeId: text('created_by_employee_id'),
  // Which agent runtime powers this employee. Stored as free text so any
  // agent id acpx's registry surfaces is a legal value — validation happens
  // at hire time against the live detection list, not at the column level.
  agentKind: text('agent_kind').notNull().default('claude'),
  modelId: text('model_id'),
  reasoningEffort: text('reasoning_effort', {
    enum: ['none', 'low', 'medium', 'high'],
  }),
  // Where the agent runs (cwd). Sandboxed per-employee at hire time; null
  // means "fall back to $HOME at session-start" (covers pre-migration rows).
  workspacePath: text('workspace_path'),
  // Which hire-flow template the user picked. Pins the role title and
  // the locked instruction block written into the agent-aware
  // instruction file. Null for pre-migration rows.
  templateId: text('template_id'),
  // Free-text "how should this employee work?" content. Only populated
  // when templateId is 'blank' (the Custom template); for named
  // templates the role-section content comes from the template's
  // `instructions` field, not the row.
  customInstructions: text('custom_instructions'),
  // Tab group inside the shared app BrowserOS window. Created at hire
  // time with chrome://newtab as a placeholder, then injected into MCP
  // page-creating tool args via X-BrowserOS-Default-Tab-Group-Id so
  // every tab this employee opens lands in their group. Null until the
  // hire flow finishes the group bootstrap.
  tabGroupId: text('tab_group_id'),
  hiredAt: integer('hired_at', { mode: 'timestamp_ms' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
})

export type Employee = typeof employees.$inferSelect
export type NewEmployee = typeof employees.$inferInsert
