import { beforeEach, describe, expect, it, mock } from 'bun:test'
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

const { loadProviders, providersStorage } = await import('./storage')

const timestamp = 1000

const browserOSProvider: LlmProviderConfig = {
  id: 'browseros',
  type: 'browseros',
  name: 'BrowserOS',
  modelId: 'browseros-auto',
  supportsImages: true,
  contextWindow: 200000,
  temperature: 0.2,
  createdAt: timestamp,
  updatedAt: timestamp,
}

describe('loadProviders', () => {
  beforeEach(() => {
    storageValues.clear()
  })

  it('drops legacy Qwen OAuth providers that cannot be repaired locally', async () => {
    const legacyQwen: LlmProviderConfig = {
      id: 'qwen-oauth',
      type: 'qwen-code',
      name: 'Qwen Code',
      modelId: 'coder-model',
      supportsImages: true,
      contextWindow: 1000000,
      temperature: 0.2,
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    await providersStorage.setValue([browserOSProvider, legacyQwen])

    const providers = await loadProviders()

    expect(providers).toEqual([browserOSProvider])
    expect(await providersStorage.getValue()).toEqual([browserOSProvider])
  })

  it('keeps Qwen API-key providers with endpoint credentials', async () => {
    const apiKeyQwen: LlmProviderConfig = {
      id: 'qwen-api-key',
      type: 'qwen-code',
      name: 'Qwen Code',
      baseUrl: 'https://coding.dashscope.aliyuncs.com/v1',
      apiKey: 'sk-test',
      modelId: 'qwen3-coder-plus',
      supportsImages: true,
      contextWindow: 1000000,
      temperature: 0.2,
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    await providersStorage.setValue([browserOSProvider, apiKeyQwen])

    await expect(loadProviders()).resolves.toEqual([
      browserOSProvider,
      apiKeyQwen,
    ])
  })

  it('repairs Qwen API-key providers saved with the removed OAuth model id', async () => {
    const repairableQwen: LlmProviderConfig = {
      id: 'qwen-api-key',
      type: 'qwen-code',
      name: 'Qwen Code',
      baseUrl: 'https://coding.dashscope.aliyuncs.com/v1',
      apiKey: 'sk-test',
      modelId: 'coder-model',
      supportsImages: true,
      contextWindow: 1000000,
      temperature: 0.2,
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    await providersStorage.setValue([browserOSProvider, repairableQwen])

    const providers = await loadProviders()

    expect(providers[1]).toMatchObject({
      id: 'qwen-api-key',
      modelId: 'qwen3-coder-plus',
      apiKey: 'sk-test',
      baseUrl: 'https://coding.dashscope.aliyuncs.com/v1',
    })
    expect(await providersStorage.getValue()).toEqual(providers)
  })
})
