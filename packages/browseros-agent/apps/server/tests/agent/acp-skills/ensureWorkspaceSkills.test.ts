import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { access, lstat, mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { LLM_PROVIDERS } from '@browseros/shared/schemas/llm'
import { ensureWorkspaceSkills } from '../../../src/agent/acp-skills/ensureWorkspaceSkills'

// Isolate BROWSEROS_DIR for the getBundledBrowserOsSkillRoot side effect
// (materialising the source SKILL.md). Otherwise every test would race
// against the developer's real ~/.browseros-config cache.
let sandboxBrowserosDir: string

beforeEach(async () => {
  sandboxBrowserosDir = await mkdtemp(join(tmpdir(), 'bos-skills-sandbox-'))
  process.env.BROWSEROS_DIR = sandboxBrowserosDir
})

afterEach(async () => {
  await rm(sandboxBrowserosDir, { recursive: true, force: true })
  delete process.env.BROWSEROS_DIR
})

async function makeWorkspace(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'bos-skills-workspace-'))
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

describe('ensureWorkspaceSkills', () => {
  it('materialises the browseros SKILL.md under .codex/skills for the Codex provider', async () => {
    const workspacePath = await makeWorkspace()
    try {
      const result = await ensureWorkspaceSkills({
        workspacePath,
        providerType: LLM_PROVIDERS.CODEX,
        isNewConversation: true,
      })
      expect(result.action).toBe('installed')

      const linkPath = join(
        workspacePath,
        '.codex',
        'skills',
        'browseros',
        'SKILL.md',
      )
      expect(await exists(linkPath)).toBe(true)
      const body = await readFile(linkPath, 'utf8')
      // Frontmatter description drives Codex's auto-activation on
      // browser-flavoured turns; the prohibition line is what overrides
      // the "agent.browsers" / "computer_use" default drift.
      expect(body).toContain('description: Use BrowserOS MCP')
      expect(body).toContain('mcp__browseros.*')
      expect(body).toContain('Do not attempt `agent.browsers.get(...)`')
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })

  it('materialises the browseros SKILL.md under .claude/skills for the Claude Code provider', async () => {
    const workspacePath = await makeWorkspace()
    try {
      const result = await ensureWorkspaceSkills({
        workspacePath,
        providerType: LLM_PROVIDERS.CLAUDE_CODE,
        isNewConversation: true,
      })
      expect(result.action).toBe('installed')

      const linkPath = join(
        workspacePath,
        '.claude',
        'skills',
        'browseros',
        'SKILL.md',
      )
      expect(await exists(linkPath)).toBe(true)
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })

  it('skips unsupported providers without touching the workspace', async () => {
    const workspacePath = await makeWorkspace()
    try {
      const result = await ensureWorkspaceSkills({
        workspacePath,
        providerType: LLM_PROVIDERS.BROWSEROS,
        isNewConversation: true,
      })
      expect(result.action).toBe('skipped-unsupported-provider')
      if (result.action === 'skipped-unsupported-provider') {
        expect(result.providerType).toBe(LLM_PROVIDERS.BROWSEROS)
      }
      // No .codex or .claude subdirs should have been created for a
      // non-ACP provider.
      expect(await exists(join(workspacePath, '.codex'))).toBe(false)
      expect(await exists(join(workspacePath, '.claude'))).toBe(false)
      expect(await exists(join(workspacePath, '.browseros-skills'))).toBe(false)
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })

  it('is idempotent — a second call does not rewrite the link target', async () => {
    // The user-facing invariant here is "the SKILL.md in the workspace
    // is not disturbed on a repeat call." The action label
    // (installed vs already-present) is a best-effort observability
    // signal derived from the manager's own return codes and is
    // permitted to swing between the two on repeat calls; what we
    // actually care about is the on-disk target being stable.
    const workspacePath = await makeWorkspace()
    try {
      const first = await ensureWorkspaceSkills({
        workspacePath,
        providerType: LLM_PROVIDERS.CODEX,
        isNewConversation: true,
      })
      expect(first.action).toBe('installed')

      const linkPath = join(
        workspacePath,
        '.codex',
        'skills',
        'browseros',
        'SKILL.md',
      )
      const firstMtime = (await lstat(linkPath)).mtimeMs

      const second = await ensureWorkspaceSkills({
        workspacePath,
        providerType: LLM_PROVIDERS.CODEX,
        isNewConversation: false,
      })
      expect(['installed', 'already-present']).toContain(second.action)

      const secondMtime = (await lstat(linkPath)).mtimeMs
      expect(secondMtime).toBe(firstMtime)
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })

  it("does not write into the user's ~/.codex or ~/.claude", async () => {
    // The design invariant is that this helper never MODIFIES the
    // user's home skills dirs. We can't assert they're empty
    // (developer machines running agent-company or the upstream
    // `skills.sh` CLI already have plenty of entries there), only that
    // this helper doesn't add / remove / touch anything.
    async function parentMtime(path: string): Promise<number | null> {
      try {
        return (await stat(path)).mtimeMs
      } catch {
        return null
      }
    }
    const codexBefore = await parentMtime(join(homedir(), '.codex', 'skills'))
    const claudeBefore = await parentMtime(join(homedir(), '.claude', 'skills'))

    const workspacePath = await makeWorkspace()
    try {
      const result = await ensureWorkspaceSkills({
        workspacePath,
        providerType: LLM_PROVIDERS.CODEX,
        isNewConversation: true,
      })
      expect(result.action).toBe('installed')

      const codexAfter = await parentMtime(join(homedir(), '.codex', 'skills'))
      const claudeAfter = await parentMtime(
        join(homedir(), '.claude', 'skills'),
      )
      expect(codexAfter).toBe(codexBefore)
      expect(claudeAfter).toBe(claudeBefore)
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })
})
