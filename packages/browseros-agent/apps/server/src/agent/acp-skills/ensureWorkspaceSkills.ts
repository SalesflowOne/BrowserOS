/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Installs BrowserOS's built-in `browseros` SKILL.md into the ACP
 * workspace directory the adapter is spawned in. Called from
 * `createAcpLanguageModel` alongside `ensureWorkspaceInstructionFile`
 * so both the workspace instruction file (AGENTS.md / CLAUDE.md) and
 * the workspace-scoped skill are in place before the ACP adapter
 * spawns and reads them from its CWD.
 *
 * Delivery mechanism is `agent-skills-manager` with `agentSkillsDirs`
 * pointing at the workspace's own `.codex/skills/` or `.claude/skills/`
 * — the project-scoped install path both adapters read from. NO writes
 * to `~/.codex/` or `~/.claude/`; the user's global agent config stays
 * untouched.
 */

import { join } from 'node:path'
import { LLM_PROVIDERS } from '@browseros/shared/schemas/llm'
import { createSkillsManager } from 'agent-skills-manager'
import { getBundledBrowserOsSkillRoot } from './getBundledBrowserOsSkillRoot'

const BROWSEROS_SKILL_NAME = 'browseros'

const AGENT_ID_BY_PROVIDER: Partial<Record<string, 'codex' | 'claude-code'>> = {
  [LLM_PROVIDERS.CODEX]: 'codex',
  [LLM_PROVIDERS.CLAUDE_CODE]: 'claude-code',
}

export interface EnsureWorkspaceSkillsOptions {
  workspacePath: string
  /**
   * Provider id (LLM_PROVIDERS.CODEX / .CLAUDE_CODE / .ACP_CUSTOM / …).
   * Non-ACP providers get a `skipped-unsupported-provider` result.
   */
  providerType: string
  /**
   * True on the first turn of a conversation. Helper is idempotent
   * regardless; this flows through to the log line for observability.
   */
  isNewConversation: boolean
}

export type EnsureWorkspaceSkillsResult =
  | { action: 'installed'; skillPath: string }
  | { action: 'already-present'; skillPath: string }
  | { action: 'skipped-unsupported-provider'; providerType: string }
  | { action: 'failed'; providerType: string; error: Error }

export async function ensureWorkspaceSkills(
  options: EnsureWorkspaceSkillsOptions,
): Promise<EnsureWorkspaceSkillsResult> {
  const agentId = AGENT_ID_BY_PROVIDER[options.providerType]
  if (!agentId) {
    return {
      action: 'skipped-unsupported-provider',
      providerType: options.providerType,
    }
  }

  // Bundle store + link target both live inside the workspace so
  // deleting `<workspacePath>` wipes everything the tool wrote.
  const skillsWorkspaceDir = join(options.workspacePath, '.browseros-skills')
  const projectAgentSkillsDir =
    agentId === 'codex'
      ? join(options.workspacePath, '.codex', 'skills')
      : join(options.workspacePath, '.claude', 'skills')

  try {
    const source = await getBundledBrowserOsSkillRoot()
    const manager = createSkillsManager({
      workspaceDir: skillsWorkspaceDir,
      agentSkillsDirs: { [agentId]: projectAgentSkillsDir },
    })

    // `add()` is idempotent — repeated calls land in the `skipped`
    // bucket with a stable reason. `link()` is idempotent too — the
    // returned `created: false` marks a same-target no-op.
    const addResult = await manager.add({ source, localMode: 'copy' })
    const linkResult = await manager.link({
      skillName: BROWSEROS_SKILL_NAME,
      agent: agentId,
      agentSkillsDir: projectAgentSkillsDir,
    })

    const skillPath = join(
      projectAgentSkillsDir,
      BROWSEROS_SKILL_NAME,
      'SKILL.md',
    )
    // "already-present" only when BOTH the bundle add and the agent
    // link were no-ops — either surfacing as fresh work means we
    // should log this turn as an install.
    const alreadyPresent =
      addResult.skipped.some((s) => s.name === BROWSEROS_SKILL_NAME) &&
      !linkResult.created
    return {
      action: alreadyPresent ? 'already-present' : 'installed',
      skillPath,
    }
  } catch (err) {
    return {
      action: 'failed',
      providerType: options.providerType,
      error: err instanceof Error ? err : new Error(String(err)),
    }
  }
}
