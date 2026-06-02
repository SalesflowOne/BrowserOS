import { ForeignPathError } from 'agent-skills-manager'
import { eq } from 'drizzle-orm'
import {
  type InstalledSkill,
  installedSkills,
} from '../../db/schema/installed_skills.sql.js'
import type { DB } from '../../db/types.js'
import { AGENT_KINDS_WITH_SKILLS, toCatalogId } from './agent-mapping.js'
import { getSkillsManager } from './skills-workspace.js'

// Wire shape returned to the renderer. The DB row supplies origin /
// disabled / installSource; the package supplies description + broken.
export interface SkillRow {
  name: string
  description: string
  disabled: boolean
  installSource: string | null
  installedAt: number
  broken: boolean
  origin: 'built-in' | 'user'
}

interface SnapshotOptions {
  includeBuiltIn?: boolean
}

/**
 * Return the user-facing view of installed skills. Joins the DB
 * `installed_skills` table against the `agent-skills-manager` manifest:
 * a row only appears in the result if BOTH agree the skill exists.
 *
 * By default built-ins are filtered out (the settings page never shows
 * them). Pass `{ includeBuiltIn: true }` for diagnostic surfaces.
 */
export async function snapshot(
  db: DB,
  options: SnapshotOptions = {},
): Promise<SkillRow[]> {
  const dbRows = await db.select().from(installedSkills)
  const manifestSkills = await getSkillsManager().listSkills()
  const manifestByName = new Map(
    manifestSkills.map((s) => [s.name, s] as const),
  )

  const rows: SkillRow[] = []
  for (const dbRow of dbRows) {
    if (!options.includeBuiltIn && dbRow.origin === 'built-in') continue
    const manifest = manifestByName.get(dbRow.name)
    rows.push({
      name: dbRow.name,
      description: manifest?.description ?? '',
      disabled: dbRow.disabled,
      installSource: dbRow.installSource,
      installedAt: dbRow.installedAt.getTime(),
      broken: Boolean(manifest?.broken) || !manifest,
      origin: dbRow.origin,
    })
  }
  // Stable order — most-recent first feels right for a settings list.
  rows.sort((a, b) => b.installedAt - a.installedAt)
  return rows
}

export {
  discoverExternalSkills,
  type ExternalSkillRow,
} from './external-skills.js'

export {
  installUserSkill,
  type PreviewedSkill,
  previewSkillSource,
  type SkillConflict,
} from './user-install.js'

/**
 * Toggle a user-installed skill. Disabling unlinks from every agent but
 * keeps the bundle on disk so re-enabling is a single re-link.
 * Re-enabling re-creates the per-agent symlinks.
 *
 * Built-in skills can't be toggled — the boot-time ensure routine would
 * just re-link them on the next launch, so the operation would be
 * non-monotonic. The route layer rejects PATCH on a built-in row before
 * we get here, but we still guard defensively.
 */
export async function setUserSkillDisabled(
  db: DB,
  name: string,
  disabled: boolean,
): Promise<void> {
  const [row] = await db
    .select()
    .from(installedSkills)
    .where(eq(installedSkills.name, name))
    .limit(1)
  if (!row) throw new SkillNotFound(name)
  if (row.origin !== 'user') {
    throw new Error('cannot toggle a built-in skill')
  }

  const manager = getSkillsManager()
  for (const agentKind of AGENT_KINDS_WITH_SKILLS) {
    if (disabled) {
      await manager.unlink({
        skillName: name,
        agent: toCatalogId(agentKind),
      })
    } else {
      try {
        await manager.link({
          skillName: name,
          agent: toCatalogId(agentKind),
        })
      } catch (err) {
        // Foreign symlink for this agent — leave it alone (same policy as
        // install). The skill stays enabled for the other agents.
        if (!(err instanceof ForeignPathError)) throw err
      }
    }
  }

  await db
    .update(installedSkills)
    .set({ disabled, updatedAt: new Date() })
    .where(eq(installedSkills.name, name))
}

/**
 * Remove a user-installed skill end-to-end: every agent's symlink, the
 * workspace bundle, and the DB row. Built-ins are refused — uninstalling
 * one would just trigger an immediate re-install on next boot.
 */
export async function uninstallUserSkill(db: DB, name: string): Promise<void> {
  const [row] = await db
    .select()
    .from(installedSkills)
    .where(eq(installedSkills.name, name))
    .limit(1)
  if (!row) throw new SkillNotFound(name)
  if (row.origin !== 'user') {
    throw new Error('cannot uninstall a built-in skill')
  }

  // removeWithLinks unlinks every recorded agent symlink and deletes the
  // workspace bundle in one call. `agent-skills-manager` is the authority
  // on which agents were linked; we don't need to walk our own mapping.
  await getSkillsManager().removeWithLinks({ skillName: name })
  await db.delete(installedSkills).where(eq(installedSkills.name, name))
}

/**
 * Upsert a built-in skill row in the DB after the ensure routine has
 * verified the workspace bundle and per-agent symlinks. Exposed only to
 * `ensure-built-ins.ts`; the route layer never calls this.
 */
export async function recordBuiltInSkill(db: DB, name: string): Promise<void> {
  const now = new Date()
  await db
    .insert(installedSkills)
    .values({
      name,
      origin: 'built-in',
      disabled: false,
      installSource: null,
      installedAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: installedSkills.name,
      set: {
        origin: 'built-in',
        disabled: false,
        updatedAt: now,
      },
    })
}

/** Returns the raw DB row for a name, or null. Used by route guards. */
export async function getInstalledSkillRow(
  db: DB,
  name: string,
): Promise<InstalledSkill | null> {
  const [row] = await db
    .select()
    .from(installedSkills)
    .where(eq(installedSkills.name, name))
    .limit(1)
  return row ?? null
}

export class SkillNotFound extends Error {
  constructor(public readonly skillName: string) {
    super(`skill not found: ${skillName}`)
  }
}
