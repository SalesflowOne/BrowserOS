import { employees } from '../../db/schema/employees.sql.js'
import type { DB } from '../../db/types.js'
import { seedWorkspace } from './seed.js'

/**
 * Re-seed every employee's workspace files (SOUL.md + instruction file)
 * on each app launch. seedWorkspace overwrites SOUL.md and the agent-
 * aware instruction file unconditionally; MEMORY.md and the life/ dirs
 * are write-if-missing so the agent's lazy edits survive. This is the
 * rollout path for instruction-file changes — when we add a new
 * section to buildInstructionFile (e.g. the title-naming nudge), the
 * next launch refreshes every existing employee.
 *
 * Idempotent in steady state: each call is a few `writeFile`s and
 * `mkdir`s. Failures per-employee are logged, never thrown — boot must
 * not depend on this routine.
 */
export async function ensureWorkspacesUpToDate(db: DB): Promise<void> {
  const rows = await db.select().from(employees).all()
  for (const row of rows) {
    try {
      await seedWorkspace(row)
    } catch (err) {
      // biome-ignore lint/suspicious/noConsole: non-fatal — boot must not depend on workspace re-seeding
      console.warn(
        `[ensure-workspaces] re-seed failed for employee ${row.id}:`,
        err,
      )
    }
  }
}
