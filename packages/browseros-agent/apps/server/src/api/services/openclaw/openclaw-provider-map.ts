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

const PROVIDER_ENV_VARS: Record<SupportedOpenClawProvider, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  moonshot: 'MOONSHOT_API_KEY',
  openai: 'OPENAI_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
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

export function getOpenClawProviderEnvVar(
  providerType: SupportedOpenClawProvider,
): string {
  return PROVIDER_ENV_VARS[providerType]
}

export function resolveSupportedOpenClawProvider(input: {
  providerType?: string
  providerName?: string
  baseUrl?: string
  apiKey?: string
  modelId?: string
}): {
  envValues: Record<string, string>
  model?: string
  providerType?: SupportedOpenClawProvider
} {
  const providerType = assertSupportedOpenClawProvider(input.providerType)
  if (!providerType) {
    return { envValues: {} }
  }

  const envVar = getOpenClawProviderEnvVar(providerType)
  return {
    envValues: input.apiKey ? { [envVar]: input.apiKey } : {},
    model: buildOpenClawModelRef(providerType, input.modelId),
    providerType,
  }
}
