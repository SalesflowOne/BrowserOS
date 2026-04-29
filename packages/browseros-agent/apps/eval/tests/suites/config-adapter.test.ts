import { describe, expect, it } from 'bun:test'
import { adaptEvalConfigFile } from '../../src/suites/config-adapter'

describe('adaptEvalConfigFile', () => {
  it('preserves browseros-agent-weekly config semantics', async () => {
    const adapted = await adaptEvalConfigFile(
      'apps/eval/configs/browseros-agent-weekly.json',
    )

    expect(adapted.suite.id).toBe('browseros-agent-weekly')
    expect(adapted.suite.dataset).toBe('../data/webbench-2of4-50.jsonl')
    expect(adapted.suite.graders).toEqual(['performance_grader'])
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
      'apps/eval/configs/browseros-agent-weekly.json',
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
})
