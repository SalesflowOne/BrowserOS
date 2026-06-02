import { readlink } from 'node:fs/promises'
import { join } from 'node:path'
import { ForeignPathError, resolveAgentSkillsDir } from 'agent-skills-manager'
import { installedSkills } from '../../db/schema/installed_skills.sql.js'
import type { DB } from '../../db/types.js'
import type { AgentKind } from '../../shared/agents/capabilities.constants.js'
import { AGENT_KINDS_WITH_SKILLS, toCatalogId } from './agent-mapping.js'
import { getSkillsManager } from './skills-workspace.js'

export interface PreviewedSkill {
  name: string
  description: string
}

/**
 * Materialise every skill from a user-typed source into the workspace and
 * return the list so the UI can show a checkbox-pick step. Bundles land in
 * `${SKILLS_WORKSPACE_DIR}/<name>/` but no per-agent symlinks are created
 * and no DB row is inserted — they stay "staged" until `installUserSkill`
 * commits or `sweepOrphans` cleans them up.
 *
 * Any orphan bundles from a previous abandoned preview are swept first so
 * the returned list reflects exactly this source.
 */
export async function previewSkillSource(
  db: DB,
  source: string,
): Promise<PreviewedSkill[]> {
  await sweepOrphans(db)
  const manager = getSkillsManager()
  const addResult = await manager.add({ source })
  if (addResult.added.length === 0) {
    const reason =
      addResult.failed[0]?.error ??
      addResult.skipped[0]?.reason ??
      'no skills found at source'
    throw new Error(reason)
  }
  const manifest = await manager.listSkills()
  const byName = new Map(manifest.map((m) => [m.name, m]))
  return addResult.added.map((a) => ({
    name: a.name,
    description: byName.get(a.name)?.description ?? '',
  }))
}

/**
 * Conflict surfaced when an agent's skills dir already contains a symlink
 * with the same name pointing outside our workspace (i.e. the user is
 * already managing that skill via another tool). We honour the external
 * version: leave the existing symlink alone, install the skill for the
 * other agents, and tell the caller so the UI can show a gentle
 * "already installed via external sources" message.
 */
export interface SkillConflict {
  name: string
  agent: AgentKind
  externalTarget: string
}

/**
 * Commit a subset of previously-staged skills: link each name into every
 * agent's skills dir (skipping foreign-symlink conflicts), write the DB
 * row, then sweep any remaining staged bundles the user didn't pick.
 * Non-conflict failures still roll back the whole batch.
 */
export async function installUserSkill(
  db: DB,
  source: string,
  names: string[],
): Promise<{ installed: string[]; conflicts: SkillConflict[] }> {
  if (names.length === 0) throw new Error('select at least one skill')
  const manager = getSkillsManager()
  const conflicts: SkillConflict[] = []

  try {
    for (const name of names) {
      await linkSkillAcrossAgents(name, conflicts)
    }
    // Row inserts in a transaction so partial DB failure rolls back.
    const now = new Date()
    await db.transaction(async (tx) => {
      for (const name of names) {
        await tx
          .insert(installedSkills)
          .values({
            name,
            origin: 'user',
            disabled: false,
            installSource: source,
            installedAt: now,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: installedSkills.name,
            set: {
              disabled: false,
              installSource: source,
              updatedAt: now,
            },
          })
      }
    })
  } catch (err) {
    for (const name of names) {
      try {
        await manager.removeWithLinks({ skillName: name })
      } catch {
        // best-effort rollback
      }
    }
    throw err
  }

  await sweepOrphans(db)
  return { installed: names, conflicts }
}

async function linkSkillAcrossAgents(
  name: string,
  conflicts: SkillConflict[],
): Promise<void> {
  const manager = getSkillsManager()
  for (const agentKind of AGENT_KINDS_WITH_SKILLS) {
    try {
      await manager.link({ skillName: name, agent: toCatalogId(agentKind) })
    } catch (err) {
      if (!(err instanceof ForeignPathError)) throw err
      conflicts.push({
        name,
        agent: agentKind,
        externalTarget: await readForeignTarget(agentKind, name),
      })
    }
  }
}

async function readForeignTarget(
  agentKind: AgentKind,
  skillName: string,
): Promise<string> {
  try {
    const dir = resolveAgentSkillsDir(toCatalogId(agentKind))
    return await readlink(join(dir, skillName))
  } catch {
    return ''
  }
}

/**
 * Remove every workspace bundle that has a manifest entry but no DB row.
 * These are stranded staged previews from an abandoned install dialog.
 * Tracked skills (built-in or user-installed) are left alone.
 */
export async function sweepOrphans(db: DB): Promise<void> {
  const manager = getSkillsManager()
  const [manifest, rows] = await Promise.all([
    manager.listSkills(),
    db.select({ name: installedSkills.name }).from(installedSkills),
  ])
  const tracked = new Set(rows.map((r) => r.name))
  for (const m of manifest) {
    if (tracked.has(m.name)) continue
    try {
      await manager.removeWithLinks({ skillName: m.name })
    } catch {
      // best-effort sweep — the next preview will try again
    }
  }
}
