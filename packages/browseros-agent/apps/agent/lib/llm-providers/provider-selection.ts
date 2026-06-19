import type { LlmProviderConfig } from './types'

export const DEFAULT_PROVIDER_ID = 'browseros'
export const DEFAULT_PROVIDER_NAME = 'BrowserOS'

/** Returns true when a provider can be selected as the default chat target. */
export function isSelectableDefaultProvider(
  provider: LlmProviderConfig,
): boolean {
  if (provider.type === 'qwen-code') {
    return Boolean(provider.baseUrl && provider.apiKey)
  }
  return true
}

/** Resolves the persisted default id, repairing stale values to the first provider. */
export function resolveDefaultProviderId(
  providers: LlmProviderConfig[],
  defaultProviderId: string | null | undefined,
): string {
  const selectableProviders = providers.filter(isSelectableDefaultProvider)
  if (
    defaultProviderId &&
    selectableProviders.some((provider) => provider.id === defaultProviderId)
  ) {
    return defaultProviderId
  }
  return selectableProviders[0]?.id ?? DEFAULT_PROVIDER_ID
}

/** Resolves the provider selected by the persisted default id. */
export function resolveSelectedProvider(
  providers: LlmProviderConfig[],
  defaultProviderId: string,
): LlmProviderConfig | null {
  return (
    providers.find(
      (provider) =>
        provider.id === defaultProviderId &&
        isSelectableDefaultProvider(provider),
    ) ??
    providers.find(isSelectableDefaultProvider) ??
    null
  )
}
