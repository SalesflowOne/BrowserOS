import type { FC } from 'react'
import { Input } from '@/components/ui/input'
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
const CUSTOM_VALUE = '__custom__'

interface SetupImageModelFieldProps {
  providerType: ProviderType | undefined
  value: string
  onChange: (value: string) => void
}

/**
 * Image model picker for the OpenClaw setup dialog. Surfaces a curated
 * dropdown of vision-capable models for the chosen chat provider, plus
 * a "None" option (uploads ignored) and a "Custom..." escape hatch
 * when the user wants a model id that isn't on the recommended list.
 */
export const SetupImageModelField: FC<SetupImageModelFieldProps> = ({
  providerType,
  value,
  onChange,
}) => {
  const recommended = getRecommendedVisionModels(providerType)
  const isCustom = value !== '' && !recommended.includes(value)
  const selectValue = !value ? NONE_VALUE : isCustom ? CUSTOM_VALUE : value

  return (
    <div className="space-y-2">
      <label className="font-medium text-sm" htmlFor="image-model-select">
        Image model
      </label>
      <Select
        value={selectValue}
        onValueChange={(next) => {
          if (next === NONE_VALUE) {
            onChange('')
            return
          }
          if (next === CUSTOM_VALUE) {
            // Keep whatever the user already typed; otherwise blank so
            // the input below is empty and ready for typing.
            onChange(isCustom ? value : '')
            return
          }
          onChange(next)
        }}
      >
        <SelectTrigger id="image-model-select">
          <SelectValue placeholder="Select an image model" />
        </SelectTrigger>
        <SelectContent>
          {recommended.map((model, index) => (
            <SelectItem key={model} value={model}>
              {model}
              {index === 0 ? ' (recommended)' : ''}
            </SelectItem>
          ))}
          <SelectItem value={CUSTOM_VALUE}>Custom...</SelectItem>
          <SelectItem value={NONE_VALUE}>
            None — disable image uploads
          </SelectItem>
        </SelectContent>
      </Select>

      {selectValue === CUSTOM_VALUE && (
        <Input
          placeholder="provider/model-id (e.g. openai/gpt-4o)"
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      )}

      <p className="text-muted-foreground text-xs">
        Required for chat image uploads. The selected model must support vision
        input on the chosen provider.
      </p>
    </div>
  )
}
