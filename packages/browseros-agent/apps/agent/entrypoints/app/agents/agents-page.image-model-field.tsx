import { type FC, useMemo } from 'react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { ProviderType } from '@/lib/llm-providers/types'
import { getRecommendedVisionModels } from './vision-models'

const NONE_VALUE = '__none__'

interface PickedModelHint {
  modelId: string
  supportsImages: boolean
}

interface SetupImageModelFieldProps {
  providerType: ProviderType | undefined
  /**
   * The chat-model the user just picked from `/settings/ai`. When the
   * catalog entry says `supportsImages`, surface its modelId as a
   * recommended option — that's the most reliable signal we have for
   * custom providers (`openai-compatible` and friends), where the
   * static recommended-vision-model registry has no entry.
   */
  pickedModel?: PickedModelHint
  value: string
  onChange: (value: string) => void
}

/**
 * Image model picker for the OpenClaw setup dialog. Surfaces a curated
 * dropdown of vision-capable models for the chosen chat provider plus
 * a "None" escape. No free-text option here — anything that isn't in
 * `/settings/ai` won't have credentials plumbed through to the
 * gateway, so accepting a custom string would just create a
 * silent-failure path. To use a model that isn't in the dropdown,
 * register it in `/settings/ai` first and re-open this dialog.
 */
export const SetupImageModelField: FC<SetupImageModelFieldProps> = ({
  providerType,
  pickedModel,
  value,
  onChange,
}) => {
  const options = useMemo(() => {
    const seen = new Set<string>()
    const merged: string[] = []
    // Catalog-derived hint first — for custom providers
    // (openai-compatible, etc.) it's the only signal we have, and
    // for known providers it usually matches the chat model the
    // user already trusts.
    if (pickedModel?.supportsImages && pickedModel.modelId.trim()) {
      seen.add(pickedModel.modelId)
      merged.push(pickedModel.modelId)
    }
    for (const m of getRecommendedVisionModels(providerType)) {
      if (seen.has(m)) continue
      seen.add(m)
      merged.push(m)
    }
    return merged
  }, [providerType, pickedModel?.modelId, pickedModel?.supportsImages])

  const selectValue = !value ? NONE_VALUE : value
  const noVisionAvailable = options.length === 0

  return (
    <div className="space-y-2">
      <label className="font-medium text-sm" htmlFor="image-model-select">
        Image model
      </label>
      <Select
        value={selectValue}
        onValueChange={(next) => {
          onChange(next === NONE_VALUE ? '' : next)
        }}
      >
        <SelectTrigger id="image-model-select" disabled={noVisionAvailable}>
          <SelectValue
            placeholder={
              noVisionAvailable
                ? 'No vision-capable models in /settings/ai'
                : 'Select an image model'
            }
          />
        </SelectTrigger>
        <SelectContent>
          {options.map((model, index) => (
            <SelectItem key={model} value={model}>
              {model}
              {index === 0 ? ' (recommended)' : ''}
            </SelectItem>
          ))}
          <SelectItem value={NONE_VALUE}>
            None — disable image uploads
          </SelectItem>
        </SelectContent>
      </Select>

      <p className="text-muted-foreground text-xs">
        {noVisionAvailable ? (
          <>
            This provider's model isn't marked vision-capable. To enable image
            uploads, register a vision-capable model in{' '}
            <a href="#/settings/ai" className="underline">
              /settings/ai
            </a>{' '}
            first.
          </>
        ) : (
          'Required for chat image uploads. The selected model must support vision input on the chosen provider.'
        )}
      </p>
    </div>
  )
}
