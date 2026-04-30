import { describe, expect, it } from 'bun:test'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { adaptEvalConfigFile } from '../../src/suites/config-adapter'

describe('adaptEvalConfigFile', () => {
  it('preserves browseros-agent-weekly AGI SDK config semantics', async () => {
    const adapted = await adaptEvalConfigFile(
      'apps/eval/configs/legacy/browseros-agent-weekly.json',
    )

    expect(adapted.suite.id).toBe('browseros-agent-weekly')
    expect(adapted.suite.dataset).toBe('../../data/agisdk-real.jsonl')
    expect(adapted.suite.graders).toEqual(['agisdk_state_diff'])
    expect(adapted.suite.workers).toBe(10)
    expect(adapted.suite.restartBrowserPerTask).toBe(true)
    expect(adapted.suite.timeoutMs).toBe(1_800_000)
    expect(adapted.evalConfig.num_workers).toBe(10)
    expect(adapted.evalConfig.browseros.server_url).toBe(
      'http://127.0.0.1:9110',
    )
  })

  it('keeps API key env names public while omitting secret values', async () => {
    const adapted = await adaptEvalConfigFile(
      'apps/eval/configs/legacy/browseros-agent-weekly.json',
      {
        env: { OPENROUTER_API_KEY: 'secret-openrouter-value' },
      },
    )

    expect(adapted.variant.publicMetadata.agent.apiKeyEnv).toBe(
      'OPENROUTER_API_KEY',
    )
    expect(JSON.stringify(adapted.variant.publicMetadata)).not.toContain(
      'secret-openrouter-value',
    )
  })

  it('adapts claude-code configs without provider credentials', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'claude-code-config-'))
    const configPath = join(dir, 'claude-code-agisdk.json')
    await writeFile(
      configPath,
      JSON.stringify({
        agent: {
          type: 'claude-code',
          model: 'opus',
        },
        dataset: 'tasks.jsonl',
        num_workers: 1,
        restart_server_per_task: false,
        browseros: {
          server_url: 'http://127.0.0.1:9110',
          headless: false,
        },
      }),
    )

    const adapted = await adaptEvalConfigFile(configPath, { env: {} })

    expect(adapted.suite.agent).toEqual({ type: 'claude-code' })
    expect(adapted.variant.agent).toMatchObject({
      provider: 'claude-code',
      model: 'opus',
    })
  })
})
