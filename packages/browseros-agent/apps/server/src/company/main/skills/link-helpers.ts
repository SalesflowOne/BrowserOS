import { lstat, readlink, unlink } from 'node:fs/promises'
import path from 'node:path'
import {
  ForeignPathError,
  resolveAgentSkillsDir,
  type SkillsManager,
} from 'agent-skills-manager'
import type { SupportedAgentKind } from '../../shared/agents/capabilities.constants.js'
import { toCatalogId } from './agent-mapping.js'
import { SKILLS_WORKSPACE_DIR } from './skills-workspace.js'

export type EnsureLinkOutcome =
  | { kind: 'linked' }
  | { kind: 'skipped'; reason: 'foreign' }
  | { kind: 'error'; cause: unknown }

// Wraps a single `manager.link` call with stale-symlink cleanup.
//
// If a symlink already exists at the agent's expected path but
// resolves to a location outside our workspace (e.g. a legacy path
// from before a rename, or a symlink the user pointed elsewhere),
// remove it so manager.link can create the fresh one. Non-symlink
// entries (regular dirs/files the user owns) are left alone and the
// call returns `skipped:foreign` — matches the package's
// ForeignPathError philosophy.
//
// Errors from the underlying link are caught and returned so the
// caller can decide whether to keep walking other agents or roll up
// the failure.
export async function ensureLinkForAgent(
  manager: SkillsManager,
  skillName: string,
  agentKind: SupportedAgentKind,
): Promise<EnsureLinkOutcome> {
  const agentId = toCatalogId(agentKind)
  const expectedTarget = path.join(SKILLS_WORKSPACE_DIR, skillName)

  let agentSkillsDir: string
  try {
    agentSkillsDir = resolveAgentSkillsDir(agentId)
  } catch (cause) {
    return { kind: 'error', cause }
  }
  const linkPath = path.join(agentSkillsDir, skillName)

  try {
    const stat = await lstat(linkPath)
    if (!stat.isSymbolicLink()) {
      return { kind: 'skipped', reason: 'foreign' }
    }
    const raw = await readlink(linkPath)
    const resolved = path.isAbsolute(raw)
      ? raw
      : path.resolve(path.dirname(linkPath), raw)
    if (resolved !== expectedTarget) {
      await unlink(linkPath)
    }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code !== 'ENOENT') {
      return { kind: 'error', cause: err }
    }
  }

  try {
    await manager.link({ skillName, agent: agentId })
    return { kind: 'linked' }
  } catch (err) {
    if (err instanceof ForeignPathError) {
      return { kind: 'skipped', reason: 'foreign' }
    }
    return { kind: 'error', cause: err }
  }
}
