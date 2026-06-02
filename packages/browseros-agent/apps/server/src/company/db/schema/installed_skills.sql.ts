import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const installedSkills = sqliteTable('installed_skills', {
  // Sanitised workspace dir name — also the lookup key into the
  // `agent-skills-manager` package's manifest.
  name: text('name').primaryKey(),
  // 'user' rows are visible in settings and freely manageable. 'built-in'
  // rows are inserted by the boot-time ensure routine (`ensureBuiltInSkills`)
  // and hidden from the settings list; the UI never shows them.
  origin: text('origin', { enum: ['user', 'built-in'] }).notNull(),
  // false = active (symlinks present in each agent's skills dir),
  // true  = disabled (bundle preserved in workspace, agent symlinks removed).
  // Built-in rows are always false.
  disabled: integer('disabled', { mode: 'boolean' }).notNull().default(false),
  // Source string the user typed at install time, verbatim. Stored so the
  // settings UI can offer "reinstall" against a broken bundle. Null for
  // built-ins (their source is hard-coded in BUILT_IN_SKILLS).
  installSource: text('install_source'),
  installedAt: integer('installed_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
})

export type InstalledSkill = typeof installedSkills.$inferSelect
export type NewInstalledSkill = typeof installedSkills.$inferInsert
