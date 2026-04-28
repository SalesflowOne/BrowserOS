/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

export const SUPPORTED_OPENCLAW_PROVIDERS = [
  'openrouter',
  'openai',
  'anthropic',
  'moonshot',
] as const

export type SupportedOpenClawProvider =
  (typeof SUPPORTED_OPENCLAW_PROVIDERS)[number]

export interface CustomOpenClawProviderConfig {
  providerId: string
  apiKeyEnvVar: string
  config: Record<string, unknown>
}

export interface ResolvedOpenClawProviderConfig {
  envValues: Record<string, string>
  model?: string
  providerType?: SupportedOpenClawProvider
  customProvider?: CustomOpenClawProviderConfig
}

const PROVIDER_ENV_VARS: Record<SupportedOpenClawProvider, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  moonshot: 'MOONSHOT_API_KEY',
  openai: 'OPENAI_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
}

/**
 * Recommended vision-capable models per supported provider. Used by the
 * UI to default the "Image model" picker once the user picks a chat
 * provider, and by the server to seed `agents.defaults.imageModel`
 * during onboard. The first entry is treated as the recommended
 * default; the rest are listed as additional choices.
 *
 * Keep these aligned with the OpenClaw upstream's
 * `media-understanding-provider.ts` plugin per provider — if upstream
 * stops shipping a model id here, the gateway will reject it with a
 * "model not found" error at chat time.
 */
const PROVIDER_VISION_MODELS: Record<SupportedOpenClawProvider, string[]> = {
  anthropic: [
    'claude-sonnet-4-5',
    'claude-sonnet-4',
    'claude-opus-4-1',
    'claude-3-5-sonnet-latest',
    'claude-3-5-haiku-latest',
  ],
  moonshot: ['moonshot-v1-32k-vision-preview', 'moonshot-v1-8k-vision-preview'],
  openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo'],
  openrouter: [
    'anthropic/claude-sonnet-4-5',
    'openai/gpt-4o',
    'google/gemini-1.5-pro',
  ],
}

export class UnsupportedOpenClawProviderError extends Error {
  constructor(providerType: string) {
    super(`Unsupported OpenClaw provider: ${providerType}`)
    this.name = 'UnsupportedOpenClawProviderError'
  }
}

export function isUnsupportedOpenClawProviderError(
  error: unknown,
): error is UnsupportedOpenClawProviderError {
  return (
    error instanceof UnsupportedOpenClawProviderError ||
    (error instanceof Error &&
      error.name === 'UnsupportedOpenClawProviderError')
  )
}

export function isSupportedOpenClawProvider(
  providerType: string,
): providerType is SupportedOpenClawProvider {
  return SUPPORTED_OPENCLAW_PROVIDERS.includes(
    providerType as SupportedOpenClawProvider,
  )
}

export function assertSupportedOpenClawProvider(
  providerType?: string,
): SupportedOpenClawProvider | undefined {
  if (!providerType) {
    return undefined
  }
  if (!isSupportedOpenClawProvider(providerType)) {
    throw new UnsupportedOpenClawProviderError(providerType)
  }
  return providerType
}

export function buildOpenClawModelRef(
  providerType: SupportedOpenClawProvider,
  modelId?: string,
): string | undefined {
  return modelId ? `${providerType}/${modelId}` : undefined
}

export function deriveOpenClawProviderId(input: {
  providerType?: string
  providerName?: string
  baseUrl?: string
}): string {
  const source =
    input.providerName?.trim() ||
    input.baseUrl?.trim() ||
    input.providerType?.trim() ||
    'custom-provider'

  const candidate = source
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

  return candidate || 'custom-provider'
}

export function deriveOpenClawApiKeyEnvVar(providerId: string): string {
  return `${providerId.toUpperCase().replace(/-/g, '_')}_API_KEY`
}

export function getOpenClawProviderEnvVar(
  providerType: SupportedOpenClawProvider,
): string {
  return PROVIDER_ENV_VARS[providerType]
}

/**
 * Returns the recommended vision-capable model ids for a provider.
 * The first entry is the default suggestion. Empty array means the
 * provider has no known vision-capable model in our catalog — the UI
 * should surface a free-text input in that case.
 */
export function getRecommendedVisionModels(
  providerType: SupportedOpenClawProvider,
): string[] {
  return [...(PROVIDER_VISION_MODELS[providerType] ?? [])]
}

/**
 * Returns the default vision model for a provider, or undefined if
 * we don't ship a recommendation for it (e.g. custom providers).
 */
export function getDefaultVisionModelId(
  providerType: SupportedOpenClawProvider,
): string | undefined {
  return PROVIDER_VISION_MODELS[providerType]?.[0]
}

/**
 * Build a fully-qualified vision model ref (provider/model) from the
 * provider and the bare model id the user picked. Mirrors
 * `buildOpenClawModelRef` so OpenClaw can resolve the model the same
 * way it does for the chat model.
 */
export function buildVisionModelRef(
  providerType: SupportedOpenClawProvider,
  modelId?: string,
): string | undefined {
  return modelId ? `${providerType}/${modelId}` : undefined
}

export function resolveSupportedOpenClawProvider(input: {
  providerType?: string
  providerName?: string
  baseUrl?: string
  apiKey?: string
  modelId?: string
}): ResolvedOpenClawProviderConfig {
  if (!input.providerType) {
    return { envValues: {} }
  }

  if (isSupportedOpenClawProvider(input.providerType)) {
    const providerType = input.providerType
    const envVar = getOpenClawProviderEnvVar(providerType)
    return {
      envValues: input.apiKey ? { [envVar]: input.apiKey } : {},
      model: buildOpenClawModelRef(providerType, input.modelId),
      providerType,
    }
  }

  if (!input.baseUrl) {
    throw new UnsupportedOpenClawProviderError(input.providerType)
  }

  const providerId = deriveOpenClawProviderId(input)
  const apiKeyEnvVar = deriveOpenClawApiKeyEnvVar(providerId)

  return {
    envValues: input.apiKey ? { [apiKeyEnvVar]: input.apiKey } : {},
    model: input.modelId ? `${providerId}/${input.modelId}` : undefined,
    customProvider: {
      providerId,
      apiKeyEnvVar,
      config: {
        api: 'openai-completions',
        baseUrl: input.baseUrl,
        apiKey: `\${${apiKeyEnvVar}}`,
        ...(input.modelId
          ? {
              models: [{ id: input.modelId, name: input.modelId }],
            }
          : {}),
      },
    },
  }
}
