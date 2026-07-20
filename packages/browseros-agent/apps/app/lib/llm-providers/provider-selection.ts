import type { LlmProviderConfig } from './types'
import { isOwebProduct } from '../product-config'

export const DEFAULT_PROVIDER_ID = isOwebProduct() ? 'oweb' : 'browseros'
export const DEFAULT_PROVIDER_NAME = isOwebProduct() ? 'OWeb' : 'BrowserOS'

/** Resolves the persisted default id, repairing stale values to the first provider. */
export function resolveDefaultProviderId(
  providers: LlmProviderConfig[],
  defaultProviderId: string | null | undefined,
): string {
  if (
    defaultProviderId &&
    providers.some((provider) => provider.id === defaultProviderId)
  ) {
    return defaultProviderId
  }
  return providers[0]?.id ?? DEFAULT_PROVIDER_ID
}

/** Resolves the provider selected by the persisted default id. */
export function resolveSelectedProvider(
  providers: LlmProviderConfig[],
  defaultProviderId: string,
): LlmProviderConfig | null {
  return (
    providers.find((provider) => provider.id === defaultProviderId) ??
    providers[0] ??
    null
  )
}
