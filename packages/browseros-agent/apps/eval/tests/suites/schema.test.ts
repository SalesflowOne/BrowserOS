import { describe, expect, it } from 'bun:test'
import { resolveVariant } from '../../src/suites/resolve-variant'
import { EvalSuiteSchema } from '../../src/suites/schema'

describe('EvalSuiteSchema', () => {
  it('validates suite settings used by the eval pipeline', () => {
    const suite = EvalSuiteSchema.parse({
      id: 'agisdk-daily-10',
      dataset: 'data/agisdk-daily-10.jsonl',
      agent: {
        type: 'orchestrated',
        executorBackend: 'tool-loop',
      },
      graders: ['agisdk_state_diff'],
      workers: 4,
      restartBrowserPerTask: true,
      timeoutMs: 1_800_000,
    })

    expect(suite.id).toBe('agisdk-daily-10')
    expect(suite.agent.type).toBe('orchestrated')
    expect(suite.agent.executorBackend).toBe('tool-loop')
    expect(suite.workers).toBe(4)
  })

  it('rejects suites without a dataset', () => {
    const parsed = EvalSuiteSchema.safeParse({
      id: 'bad-suite',
      agent: { type: 'tool-loop' },
      graders: ['performance_grader'],
    })

    expect(parsed.success).toBe(false)
  })
})

describe('resolveVariant', () => {
  it('prefers CLI values over env values and does not expose raw API keys', () => {
    const variant = resolveVariant({
      variantId: 'cli-variant',
      provider: 'anthropic',
      model: 'claude-test',
      apiKey: 'cli-secret',
      baseUrl: 'https://cli.example/v1',
      env: {
        EVAL_VARIANT: 'env-variant',
        EVAL_AGENT_PROVIDER: 'openai-compatible',
        EVAL_AGENT_MODEL: 'env-model',
        EVAL_AGENT_API_KEY: 'env-secret',
        EVAL_AGENT_BASE_URL: 'https://env.example/v1',
      },
    })

    expect(variant.id).toBe('cli-variant')
    expect(variant.agent.provider).toBe('anthropic')
    expect(variant.agent.model).toBe('claude-test')
    expect(variant.agent.apiKey).toBe('cli-secret')
    expect(variant.publicMetadata.agent.apiKeyConfigured).toBe(true)
    expect(JSON.stringify(variant.publicMetadata)).not.toContain('cli-secret')
    expect(JSON.stringify(variant.publicMetadata)).not.toContain('env-secret')
  })

  it('fails clearly when credentials are required but missing', () => {
    expect(() =>
      resolveVariant({
        variantId: 'missing-key',
        provider: 'openai-compatible',
        model: 'kimi',
        env: {},
        requireApiKey: true,
      }),
    ).toThrow('EVAL_AGENT_API_KEY')
  })
})
