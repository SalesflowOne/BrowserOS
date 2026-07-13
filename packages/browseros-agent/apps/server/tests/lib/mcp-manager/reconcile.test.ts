/**
 * @license
 * Copyright 2025 BrowserOS
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  installInto,
  reconcileUrl,
  resetMcpManagerForTesting,
  setMcpManagerForTesting,
} from '../../../src/lib/mcp-manager'
import { callsOf, createStubMcpManager } from '../../_helpers/stub-mcp-manager'

async function withTempMcpEnv<T>(
  run: (paths: { claudeConfigPath: string }) => Promise<T>,
): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), 'mcp-manager-reconcile-'))
  const previous = {
    BROWSEROS_DIR: process.env.BROWSEROS_DIR,
    CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR,
    HOME: process.env.HOME,
  }
  const browserosDir = join(root, 'browseros')
  const claudeConfigDir = join(root, 'claude-config')
  const homeDir = join(root, 'home')
  const claudeConfigPath = join(claudeConfigDir, '.claude.json')
  try {
    await mkdir(claudeConfigDir, { recursive: true })
    await mkdir(homeDir, { recursive: true })
    process.env.BROWSEROS_DIR = browserosDir
    process.env.CLAUDE_CONFIG_DIR = claudeConfigDir
    process.env.HOME = homeDir
    resetMcpManagerForTesting()
    return await run({ claudeConfigPath })
  } finally {
    resetMcpManagerForTesting()
    restoreEnv(previous)
    await rm(root, { recursive: true, force: true })
  }
}

function restoreEnv(previous: {
  BROWSEROS_DIR?: string
  CLAUDE_CONFIG_DIR?: string
  HOME?: string
}): void {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
}

beforeEach(() => {
  resetMcpManagerForTesting()
})

afterEach(() => {
  resetMcpManagerForTesting()
})

describe('reconcileUrl', () => {
  it('returns noop when no browseros entry exists in the manifest', async () => {
    const stub = createStubMcpManager()
    setMcpManagerForTesting(stub)

    const result = await reconcileUrl({
      currentUrl: 'http://127.0.0.1:9100/mcp',
    })

    expect(result).toEqual({ action: 'noop', affectedAgents: [] })
    expect(callsOf(stub, 'link')).toHaveLength(0)
  })

  it('returns noop when the manifest url already matches the running url', async () => {
    const stub = createStubMcpManager()
    stub.seedServer(
      'browseros',
      { transport: 'http', url: 'http://127.0.0.1:9100/mcp' },
      [{ agent: 'claude-code' }],
    )
    setMcpManagerForTesting(stub)

    const result = await reconcileUrl({
      currentUrl: 'http://127.0.0.1:9100/mcp',
    })

    expect(result).toEqual({ action: 'noop', affectedAgents: [] })
    expect(callsOf(stub, 'link')).toHaveLength(0)
  })

  it('re-links every linked agent with the new url when the url drifted', async () => {
    const stub = createStubMcpManager()
    stub.seedServer(
      'browseros',
      { transport: 'http', url: 'http://127.0.0.1:9100/mcp' },
      [{ agent: 'claude-code' }, { agent: 'cursor' }],
    )
    setMcpManagerForTesting(stub)

    const result = await reconcileUrl({
      currentUrl: 'http://127.0.0.1:9105/mcp',
    })

    expect(result.action).toBe('updated')
    expect(result.affectedAgents.sort()).toEqual(['claude-code', 'cursor'])
    const linkCalls = callsOf(stub, 'link') as Array<{
      server: { spec: { url?: string } }
      agent: string
    }>
    expect(linkCalls.map((l) => l.agent).sort()).toEqual([
      'claude-code',
      'cursor',
    ])
    for (const call of linkCalls) {
      expect(call.server.spec.url).toBe('http://127.0.0.1:9105/mcp')
    }
  })

  it('keeps the claude-code http type field after URL drift', async () => {
    await withTempMcpEnv(async ({ claudeConfigPath }) => {
      await writeFile(claudeConfigPath, '{"mcpServers":{}}\n', 'utf8')
      await installInto('claude-code', 'http://127.0.0.1:9100/mcp')

      expect(
        JSON.parse(await readFile(claudeConfigPath, 'utf8')).mcpServers
          .browseros,
      ).toEqual({
        url: 'http://127.0.0.1:9100/mcp',
        type: 'http',
      })

      resetMcpManagerForTesting()
      const result = await reconcileUrl({
        currentUrl: 'http://127.0.0.1:9105/mcp',
      })

      expect(result).toEqual({
        action: 'updated',
        affectedAgents: ['claude-code'],
      })
      expect(
        JSON.parse(await readFile(claudeConfigPath, 'utf8')).mcpServers
          .browseros,
      ).toEqual({
        url: 'http://127.0.0.1:9105/mcp',
        type: 'http',
      })
    })
  })

  it('warn-logs a per-agent failure without aborting the rest of the reconcile', async () => {
    const stub = createStubMcpManager({
      linkThrowsByAgent: new Set(['cursor']),
    })
    stub.seedServer(
      'browseros',
      { transport: 'http', url: 'http://127.0.0.1:9100/mcp' },
      [{ agent: 'claude-code' }, { agent: 'cursor' }],
    )
    setMcpManagerForTesting(stub)

    const result = await reconcileUrl({
      currentUrl: 'http://127.0.0.1:9105/mcp',
    })

    expect(result.action).toBe('updated')
    expect(result.affectedAgents).toEqual(['claude-code'])
  })
})
