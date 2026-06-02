import path from 'node:path'
import type { SkillsManager } from 'agent-skills-manager'
import { eq } from 'drizzle-orm'
import { installedSkills } from '../../db/schema/installed_skills.sql.js'
import type { DB } from '../../db/types.js'
import { AGENT_KINDS_WITH_SKILLS } from './agent-mapping.js'
import { BUILT_IN_SKILLS, getBuiltInSkillsRoot } from './built-ins.js'
import { ensureLinkForAgent } from './link-helpers.js'
import { recordBuiltInSkill } from './service.js'
import { getSkillsManager } from './skills-workspace.js'

/**
 * Reconcile shipped built-in skills against on-disk state. Runs on every
 * app launch — the brief calls out that skills can be removed externally
 * between launches and must be re-materialised. Idempotent: if everything
 * is already in place, this routine is a few `listSkills` + `link` no-ops.
 *
 * Sequence per built-in:
 *  1. If the manifest doesn't know about the skill, `add({ source, copy })`
 *     it from `resources/built-in-skills/<name>/`.
 *  2. If the manifest entry is broken (bundle missing), remove + re-add.
 *  3. For each supported agent (`AGENT_KINDS_WITH_SKILLS`), `ensureLinkForAgent`
 *     — replaces stale symlinks, isolates each agent's link in its own
 *     try/catch so one failure doesn't drop the whole entry.
 *  4. Upsert the DB row with `origin = 'built-in'` once the bundle is
 *     materialised and at least one agent linked (partial install is OK).
 *
 * Errors are logged but never thrown: boot must not be gated on the
 * skills layer. A failure here means the user might not see a built-in
 * skill until the next launch, not that the app fails to start.
 */
export async function ensureBuiltInSkills(db: DB): Promise<void> {
  if (BUILT_IN_SKILLS.length === 0) {
    // v1 ships no built-ins yet. Still drop any stale 'built-in' rows so
    // a downgrade-then-upgrade cycle doesn't leave orphans in the DB.
    await reconcileEmptyCatalogue(db)
    return
  }

  const manager = getSkillsManager()
  const root = getBuiltInSkillsRoot()
  const state = { manifestSkills: await manager.listSkills() }

  for (const builtIn of BUILT_IN_SKILLS) {
    try {
      await materialiseBuiltIn(db, manager, root, builtIn.name, state)
    } catch (err) {
      // biome-ignore lint/suspicious/noConsole: non-fatal — boot must not depend on this routine
      console.warn(
        `[ensure-built-ins] failed to materialise "${builtIn.name}":`,
        err,
      )
    }
  }
}

interface ManifestState {
  manifestSkills: Awaited<ReturnType<SkillsManager['listSkills']>>
}

async function materialiseBuiltIn(
  db: DB,
  manager: SkillsManager,
  root: string,
  name: string,
  state: ManifestState,
): Promise<void> {
  await ensureBundle(manager, root, name, state)
  const anyLinked = await linkForAllAgents(manager, name)
  if (anyLinked) {
    await recordBuiltInSkill(db, name)
  }
}

async function ensureBundle(
  manager: SkillsManager,
  root: string,
  name: string,
  state: ManifestState,
): Promise<void> {
  let manifest = state.manifestSkills.find((s) => s.name === name)
  if (manifest?.broken) {
    await manager.remove({ skillName: name })
    manifest = undefined
    state.manifestSkills = await manager.listSkills()
  }
  if (!manifest) {
    await manager.add({
      source: path.join(root, name),
      localMode: 'copy',
    })
    state.manifestSkills = await manager.listSkills()
  }
}

async function linkForAllAgents(
  manager: SkillsManager,
  name: string,
): Promise<boolean> {
  let anyLinked = false
  for (const agentKind of AGENT_KINDS_WITH_SKILLS) {
    const outcome = await ensureLinkForAgent(manager, name, agentKind)
    if (outcome.kind === 'linked') {
      anyLinked = true
    } else if (outcome.kind === 'error') {
      // biome-ignore lint/suspicious/noConsole: visibility for a partial install
      console.warn(
        `[ensure-built-ins] link failed for "${name}" on ${agentKind}:`,
        outcome.cause,
      )
    }
  }
  return anyLinked
}

async function reconcileEmptyCatalogue(db: DB): Promise<void> {
  const stale = await db
    .select({ name: installedSkills.name })
    .from(installedSkills)
    .where(eq(installedSkills.origin, 'built-in'))
  if (stale.length === 0) return
  const manager = getSkillsManager()
  for (const { name } of stale) {
    try {
      await manager.removeWithLinks({ skillName: name })
      // Only drop the tracking row after the disk-side cleanup succeeded.
      // If we deleted the row eagerly and removeWithLinks threw, the
      // workspace bundle + agent symlinks would be orphaned and this
      // routine would never see them again on the next boot.
      await db.delete(installedSkills).where(eq(installedSkills.name, name))
    } catch (err) {
      // biome-ignore lint/suspicious/noConsole: non-fatal — orphan cleanup
      console.warn(
        `[ensure-built-ins] failed to remove orphan built-in "${name}":`,
        err,
      )
    }
  }
}
