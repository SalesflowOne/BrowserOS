import { homedir } from 'node:os'
import path from 'node:path'
import { createSkillsManager, type SkillsManager } from 'agent-skills-manager'

// Canonical store for skill bundles. Each per-agent install lives as a
// symlink in the agent's own skills dir (`~/.claude/skills/<name>`,
// `~/.codex/skills/<name>`, `~/.gemini/skills/<name>`) pointing back into
// this directory. Namespacing under `~/.browserclaw/` keeps us out of
// the package's default `~/.skills` which a user might be managing
// themselves via the upstream CLI.
export const SKILLS_WORKSPACE_DIR = path.join(
  homedir(),
  '.browserclaw',
  'skills',
)

let _mgr: SkillsManager | null = null

export function getSkillsManager(): SkillsManager {
  if (!_mgr) {
    _mgr = createSkillsManager({ workspaceDir: SKILLS_WORKSPACE_DIR })
  }
  return _mgr
}
