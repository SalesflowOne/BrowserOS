/**
 * @license
 * Copyright 2025 BrowserOS
 */

import { describe, expect, it } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  getHermesAgentHomeHostDir,
  getHermesHarnessHostDir,
  getHermesHostStateDir,
  getHermesProviderMapping,
  writeHermesPerAgentProvider,
} from '../../../../src/lib/agents/hermes'

describe('Hermes adapter helpers', () => {
  it('resolves Hermes state, harness, and per-agent home paths under vm/hermes', () => {
    const root = '/tmp/browseros'
    expect(getHermesHostStateDir(root)).toBe('/tmp/browseros/vm/hermes')
    expect(getHermesHarnessHostDir(root)).toBe(
      '/tmp/browseros/vm/hermes/harness',
    )
    expect(
      getHermesAgentHomeHostDir({ browserosDir: root, agentId: 'agent-1' }),
    ).toBe('/tmp/browseros/vm/hermes/harness/agent-1/home')
  })

  it('writes provider config and requires a base URL for custom providers', async () => {
    const browserosDir = await mkdtemp(join(tmpdir(), 'browseros-hermes-'))
    try {
      await writeHermesPerAgentProvider({
        browserosDir,
        agentId: 'agent-1',
        providerId: 'custom',
        envVarName: 'OPENAI_API_KEY',
        apiKey: 'sk-test',
        modelId: 'gpt-5.5',
        baseUrl: 'https://api.openai.com/v1',
      })
      const home = getHermesAgentHomeHostDir({
        browserosDir,
        agentId: 'agent-1',
      })
      expect(await readFile(join(home, 'config.yaml'), 'utf8')).toContain(
        'base_url: "https://api.openai.com/v1"',
      )
      expect(await readFile(join(home, '.env'), 'utf8')).toBe(
        'OPENAI_API_KEY=sk-test\n',
      )
      await expect(
        writeHermesPerAgentProvider({
          browserosDir,
          agentId: 'agent-2',
          providerId: 'custom',
          envVarName: 'OPENAI_API_KEY',
          apiKey: 'sk-test',
          modelId: 'gpt-5.5',
        }),
      ).rejects.toThrow(/requires base_url/)
    } finally {
      await rm(browserosDir, { recursive: true, force: true })
    }
  })

  it('maps BrowserOS provider types to Hermes provider config', () => {
    expect(getHermesProviderMapping('anthropic')).toEqual({
      hermesProvider: 'anthropic',
      envVarName: 'ANTHROPIC_API_KEY',
      requiresBaseUrl: false,
    })
    expect(getHermesProviderMapping('openai')?.defaultBaseUrl).toBe(
      'https://api.openai.com/v1',
    )
    expect(getHermesProviderMapping('unknown')).toBeUndefined()
  })
})
