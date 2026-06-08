import type { LlmProviderConfig, ProviderType } from './types'

const localRuntimeProviderTypes: ReadonlySet<ProviderType> = new Set([
  'codex',
  'claude-code',
])

/** Identifies provider configs backed by local CLIs instead of HTTP endpoints. */
export function isLocalRuntimeProviderType(type: ProviderType): boolean {
  return localRuntimeProviderTypes.has(type)
}

/** Identifies provider configs that can be sent to the generic chat routes. */
export function isChatProviderType(type: ProviderType): boolean {
  return !isLocalRuntimeProviderType(type)
}

/** Resolves a chat-compatible provider, skipping local runtime configs. */
export function resolveChatProvider(
  providers: LlmProviderConfig[],
  preferredProviderId?: string | null,
): LlmProviderConfig | null {
  const chatProviders = providers.filter((provider) =>
    isChatProviderType(provider.type),
  )
  if (preferredProviderId) {
    const preferred = chatProviders.find(
      (provider) => provider.id === preferredProviderId,
    )
    if (preferred) return preferred
  }
  return chatProviders[0] ?? null
}
