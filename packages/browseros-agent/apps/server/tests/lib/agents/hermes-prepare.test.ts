/**
 * @license
 * Copyright 2025 BrowserOS
 */

import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { prepareAcpxAgentContext } from '../../../src/lib/agents/acpx-agent-adapter'
import type { AgentDefinition } from '../../../src/lib/agents/agent-types'

describe('prepareHermesContext', () => {
  const tempDirs: string[] = []

  afterEach(async () => {
    await Promise.all(
      tempDirs.map((dir) => rm(dir, { recursive: true, force: true })),
    )
    tempDirs.length = 0
  })

  function makeAgent(): AgentDefinition {
    return {
      id: 'hermes-agent',
      name: 'hermes agent',
      adapter: 'hermes',
      permissionMode: 'approve-all',
      sessionKey: 'agent:hermes-agent:main',
      createdAt: 1000,
      updatedAt: 1000,
    }
  }

  it('prepares Hermes with HERMES_HOME pointing at the BrowserOS-managed agent home', async () => {
    const browserosDir = await mkdtemp(join(tmpdir(), 'browseros-hermes-'))
    tempDirs.push(browserosDir)
    const prepared = await prepareAcpxAgentContext({
      browserosDir,
      agent: makeAgent(),
      sessionId: 'main',
      sessionKey: 'agent:hermes-agent:main',
      cwdOverride: null,
      isSelectedCwd: false,
      message: 'remember this',
    })

    expect(prepared.commandEnv.HERMES_HOME).toContain('/hermes-agent/home')
    expect(prepared.commandEnv).not.toHaveProperty('AGENT_HOME')
    expect(prepared.commandEnv).not.toHaveProperty('CODEX_HOME')
    expect(prepared.commandEnv).not.toHaveProperty('CLAUDE_CONFIG_DIR')
    expect(prepared.useBrowserosMcp).toBe(true)
    expect(prepared.openclawSessionKey).toBeNull()
    expect(prepared.runtimeSessionKey).toMatch(
      /^agent:hermes-agent:main:[a-f0-9]{16}$/,
    )
  })
})
