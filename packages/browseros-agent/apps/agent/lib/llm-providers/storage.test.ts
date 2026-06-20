import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import type { LlmProviderConfig } from './types'

const storageValues = new Map<string, unknown>()
const storageVersions = new Map<string, number>()

mock.module('@wxt-dev/storage', () => ({
  storage: {
    defineItem: <T>(
      key: string,
      options?: {
        fallback?: T
        version?: number
        migrations?: Record<number, (value: T | null) => T | null>
      },
    ) => ({
      getValue: async () => {
        if (!storageValues.has(key)) return options?.fallback

        const currentVersion = options?.version
        let value = storageValues.get(key) as T | null
        if (currentVersion && options?.migrations) {
          const storedVersion = storageVersions.get(key) ?? 1
          for (
            let version = storedVersion + 1;
            version <= currentVersion;
            version++
          ) {
            const migrate = options.migrations[version]
            if (migrate) value = migrate(value)
          }
          storageValues.set(key, value)
          storageVersions.set(key, currentVersion)
        }
        return value
      },
      setValue: async (value: T) => {
        storageValues.set(key, value)
        if (options?.version) storageVersions.set(key, options.version)
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
let providersStorage: typeof import('./storage').providersStorage

beforeAll(async () => {
  ;({ loadProviders, providersStorage } = await import('./storage'))
})

beforeEach(() => {
  storageValues.clear()
  storageVersions.clear()
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
    storageVersions.set('local:llm-providers', 3)

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
    storageVersions.set('local:llm-providers', 3)

    const providers = await loadProviders()

    expect(providers.map((provider) => provider.name)).toEqual([
      'Work ChatGPT',
      'ChatGPT Plus/Pro (Work)',
    ])
    expect(storageValues.get('local:llm-providers')).toBe(storedProviders)
  })
})

describe('providersStorage', () => {
  it('migrates legacy ChatGPT display names for direct storage reads', async () => {
    storageValues.set('local:llm-providers', [
      providerConfig({
        id: 'chatgpt-pro-1',
        type: 'chatgpt-pro',
        name: 'ChatGPT Plus/Pro (user@example.com)',
      }),
    ])
    storageVersions.set('local:llm-providers', 2)

    const providers = await providersStorage.getValue()

    expect(providers?.map((provider) => provider.name)).toEqual(['ChatGPT'])
    expect(
      (storageValues.get('local:llm-providers') as LlmProviderConfig[]).map(
        (provider) => provider.name,
      ),
    ).toEqual(['ChatGPT'])
    expect(storageVersions.get('local:llm-providers')).toBe(3)
  })
})
