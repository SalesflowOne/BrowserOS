import { and, eq } from 'drizzle-orm'
import { installedSkills } from '../../db/schema/installed_skills.sql.js'
import type { DB } from '../../db/types.js'
import { AGENT_KINDS_WITH_SKILLS } from './agent-mapping.js'
import { ensureLinkForAgent } from './link-helpers.js'
import { getSkillsManager } from './skills-workspace.js'

/**
 * Re-link every enabled user-installed skill across every agent on
 * launch. Idempotent: correct symlinks are no-ops, missing ones get
 * created, stale symlinks (pointing outside our workspace) are
 * replaced. Foreign non-symlink entries (regular dirs the user owns
 * via another tool) are left alone.
 */
export async function ensureUserSkillsLinked(db: DB): Promise<void> {
  const rows = await db
    .select({ name: installedSkills.name })
    .from(installedSkills)
    .where(
      and(
        eq(installedSkills.origin, 'user'),
        eq(installedSkills.disabled, false),
      ),
    )
  if (rows.length === 0) return
  const manager = getSkillsManager()
  for (const row of rows) {
    for (const agentKind of AGENT_KINDS_WITH_SKILLS) {
      const outcome = await ensureLinkForAgent(manager, row.name, agentKind)
      if (outcome.kind === 'error') {
        // biome-ignore lint/suspicious/noConsole: non-fatal — boot must not depend on this routine
        console.warn(
          `[ensure-user-skills] failed to link "${row.name}" for ${agentKind}:`,
          outcome.cause,
        )
      }
    }
  }
}
