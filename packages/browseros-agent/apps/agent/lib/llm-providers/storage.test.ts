import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import type { LlmProviderConfig } from './types'

const storageValues = new Map<string, unknown>()

mock.module('@wxt-dev/storage', () => ({
  storage: {
    defineItem: <T>(key: string, options?: { fallback?: T }) => ({
      getValue: async () =>
        storageValues.has(key) ? storageValues.get(key) : options?.fallback,
      setValue: async (value: T) => {
        storageValues.set(key, value)
      },
      watch: () => () => {},
    }),
  },
}))

mock.module('@/lib/auth/sessionStorage', () => ({
  sessionStorage: {
    getValue: async () => null,
  },
}))

mock.module('@/lib/browseros/adapter', () => ({
  getBrowserOSAdapter: () => ({
    setPref: async () => {},
  }),
}))

mock.module('@/lib/browseros/prefs', () => ({
  BROWSEROS_PREFS: {
    PROVIDERS: 'browseros.providers',
  },
}))

mock.module('./uploadLlmProvidersToGraphql', () => ({
  uploadLlmProvidersToGraphql: async () => {},
}))

let loadProviders: typeof import('./storage').loadProviders

beforeAll(async () => {
  ;({ loadProviders } = await import('./storage'))
})

beforeEach(() => {
  storageValues.clear()
})

function providerConfig(
  overrides: Partial<LlmProviderConfig> & Pick<LlmProviderConfig, 'id'>,
): LlmProviderConfig {
  return {
    type: 'openai',
    name: 'OpenAI',
    modelId: 'gpt-5',
    supportsImages: true,
    contextWindow: 400000,
    temperature: 0.2,
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  }
}

describe('loadProviders', () => {
  it('normalizes legacy ChatGPT display names', async () => {
    storageValues.set('local:llm-providers', [
      providerConfig({
        id: 'chatgpt-pro-1',
        type: 'chatgpt-pro',
        name: 'ChatGPT Plus/Pro',
      }),
      providerConfig({
        id: 'chatgpt-pro-2',
        type: 'chatgpt-pro',
        name: 'ChatGPT Plus/Pro (user@example.com)',
      }),
    ])

    const providers = await loadProviders()

    expect(providers.map((provider) => provider.name)).toEqual([
      'ChatGPT',
      'ChatGPT',
    ])
    expect(
      (storageValues.get('local:llm-providers') as LlmProviderConfig[]).map(
        (provider) => provider.name,
      ),
    ).toEqual(['ChatGPT', 'ChatGPT'])
  })

  it('preserves custom ChatGPT provider names', async () => {
    const storedProviders = [
      providerConfig({
        id: 'chatgpt-pro-custom',
        type: 'chatgpt-pro',
        name: 'Work ChatGPT',
      }),
      providerConfig({
        id: 'chatgpt-pro-parenthetical-custom',
        type: 'chatgpt-pro',
        name: 'ChatGPT Plus/Pro (Work)',
      }),
    ]
    storageValues.set('local:llm-providers', storedProviders)

    const providers = await loadProviders()

    expect(providers.map((provider) => provider.name)).toEqual([
      'Work ChatGPT',
      'ChatGPT Plus/Pro (Work)',
    ])
    expect(storageValues.get('local:llm-providers')).toBe(storedProviders)
  })
})
