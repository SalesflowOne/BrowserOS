import type { ProviderType } from '@/lib/llm-providers/types'

/**
 * Recommended vision-capable model ids per provider — mirrors the
 * server-side registry in
 * `apps/server/src/api/services/openclaw/openclaw-provider-map.ts`.
 * Used to default the "Image model" Select when the user picks a
 * chat provider during setup or per-agent edit.
 *
 * Keep this list aligned with the server registry — if a provider
 * adds or drops a vision model upstream, both sides must update.
 */
const VISION_MODELS_BY_PROVIDER: Partial<Record<ProviderType, string[]>> = {
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

export function getRecommendedVisionModels(
  providerType: ProviderType | undefined,
): string[] {
  if (!providerType) return []
  return [...(VISION_MODELS_BY_PROVIDER[providerType] ?? [])]
}

export function getDefaultVisionModelId(
  providerType: ProviderType | undefined,
): string | undefined {
  if (!providerType) return undefined
  return VISION_MODELS_BY_PROVIDER[providerType]?.[0]
}
