import { Loader2, RotateCcw } from 'lucide-react'
import { type FC, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import type { ProviderType } from '@/lib/llm-providers/types'
import {
  type ResolvedAgentConfigValue,
  useAgentModels,
  useUpdateAgentModels,
} from './useOpenClaw'
import { getRecommendedVisionModels } from './vision-models'

const CUSTOM_VALUE = '__custom__'
const DEFAULT_VALUE = '__default__'

interface AgentModelsPanelProps {
  agentId: string
  /**
   * Provider type the agent currently runs against. Used to populate
   * the recommended-models list and to forward as the `providerType`
   * hint on the PATCH so the server can prefix the model id correctly.
   * Derived from the global default model in AgentsPage when this panel
   * is rendered (e.g. `moonshot/...` → `moonshot`).
   */
  providerType?: ProviderType
  /** Pretty model id stripped of the provider prefix. */
  defaultTextModel: string | null
  defaultImageModel: string | null
}

function stripProviderPrefix(value: string | null): string {
  if (!value) return ''
  const slash = value.indexOf('/')
  return slash === -1 ? value : value.slice(slash + 1)
}

function makeFieldState(resolved: ResolvedAgentConfigValue): {
  override: boolean
  bareValue: string
} {
  return {
    override: resolved.source === 'agent',
    bareValue: stripProviderPrefix(resolved.value),
  }
}

export const AgentModelsPanel: FC<AgentModelsPanelProps> = ({
  agentId,
  providerType,
  defaultTextModel,
  defaultImageModel,
}) => {
  const { details, loading, error } = useAgentModels(agentId)
  const updateModels = useUpdateAgentModels()

  // Form state — derived once from the loaded details, then user-driven.
  const [textOverride, setTextOverride] = useState(false)
  const [textValue, setTextValue] = useState('')
  const [imageOverride, setImageOverride] = useState(false)
  const [imageValue, setImageValue] = useState('')
  const [initialised, setInitialised] = useState(false)

  useEffect(() => {
    if (!details || initialised) return
    const text = makeFieldState(details.model)
    const image = makeFieldState(details.imageModel)
    setTextOverride(text.override)
    setTextValue(text.bareValue)
    setImageOverride(image.override)
    setImageValue(image.bareValue)
    setInitialised(true)
  }, [details, initialised])

  const visionRecommendations = useMemo(
    () => getRecommendedVisionModels(providerType),
    [providerType],
  )

  const initialState = useMemo(() => {
    if (!details) return null
    return {
      textOverride: details.model.source === 'agent',
      textValue: stripProviderPrefix(details.model.value),
      imageOverride: details.imageModel.source === 'agent',
      imageValue: stripProviderPrefix(details.imageModel.value),
    }
  }, [details])

  const dirty =
    initialState !== null &&
    (initialState.textOverride !== textOverride ||
      initialState.imageOverride !== imageOverride ||
      (textOverride && initialState.textValue !== textValue) ||
      (imageOverride && initialState.imageValue !== imageValue))

  const isSavable =
    dirty &&
    (!textOverride || !!textValue.trim()) &&
    (!imageOverride || !!imageValue.trim()) &&
    !updateModels.isPending

  const handleSave = async () => {
    if (!initialState) return
    const payload: {
      agentId: string
      model?: string | null
      imageModel?: string | null
      providerType?: string
    } = { agentId }
    if (textOverride !== initialState.textOverride) {
      payload.model = textOverride ? textValue.trim() : null
    } else if (textOverride && textValue.trim() !== initialState.textValue) {
      payload.model = textValue.trim()
    }
    if (imageOverride !== initialState.imageOverride) {
      payload.imageModel = imageOverride ? imageValue.trim() : null
    } else if (imageOverride && imageValue.trim() !== initialState.imageValue) {
      payload.imageModel = imageValue.trim()
    }
    if (providerType) payload.providerType = providerType

    try {
      const next = await updateModels.mutateAsync(payload)
      // Reseed the form state from the server-confirmed values so the
      // dirty flag clears and the (default)/(override) tag flips.
      const text = makeFieldState(next.model)
      const image = makeFieldState(next.imageModel)
      setTextOverride(text.override)
      setTextValue(text.bareValue)
      setImageOverride(image.override)
      setImageValue(image.bareValue)
      toast.success('Agent models updated')
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to update agent models',
      )
    }
  }

  const handleReset = () => {
    if (!details) return
    const text = makeFieldState(details.model)
    const image = makeFieldState(details.imageModel)
    setTextOverride(text.override)
    setTextValue(text.bareValue)
    setImageOverride(image.override)
    setImageValue(image.bareValue)
  }

  if (loading) {
    return (
      <div className="space-y-3 px-4 pb-4">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-9 w-full" />
      </div>
    )
  }

  if (error) {
    return (
      <Alert variant="destructive" className="mx-4 mb-4">
        <AlertDescription>{error.message}</AlertDescription>
      </Alert>
    )
  }

  return (
    <div className="space-y-4 border-t bg-muted/20 px-4 py-4">
      <ModelField
        idPrefix={`${agentId}-text`}
        label="Text model"
        override={textOverride}
        onOverrideChange={setTextOverride}
        value={textValue}
        onValueChange={setTextValue}
        defaultModelLabel={defaultTextModel ?? '— not set —'}
        recommendations={[]}
        customPlaceholder="provider/model-id"
      />

      <ModelField
        idPrefix={`${agentId}-image`}
        label="Image model"
        override={imageOverride}
        onOverrideChange={setImageOverride}
        value={imageValue}
        onValueChange={setImageValue}
        defaultModelLabel={defaultImageModel ?? '— not set —'}
        recommendations={visionRecommendations}
        customPlaceholder="provider/model-id (e.g. openai/gpt-4o)"
      />

      <div className="flex items-center justify-end gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={handleReset}
          disabled={!dirty || updateModels.isPending}
        >
          <RotateCcw className="mr-1 size-3.5" />
          Reset
        </Button>
        <Button
          size="sm"
          onClick={() => void handleSave()}
          disabled={!isSavable}
        >
          {updateModels.isPending ? (
            <>
              <Loader2 className="mr-2 size-4 animate-spin" />
              Saving...
            </>
          ) : (
            'Save changes'
          )}
        </Button>
      </div>
    </div>
  )
}

interface ModelFieldProps {
  idPrefix: string
  label: string
  override: boolean
  onOverrideChange: (value: boolean) => void
  value: string
  onValueChange: (value: string) => void
  defaultModelLabel: string
  recommendations: string[]
  customPlaceholder: string
}

const ModelField: FC<ModelFieldProps> = ({
  idPrefix,
  label,
  override,
  onOverrideChange,
  value,
  onValueChange,
  defaultModelLabel,
  recommendations,
  customPlaceholder,
}) => {
  const isCustom = override && value !== '' && !recommendations.includes(value)
  const selectValue = !override
    ? DEFAULT_VALUE
    : isCustom || recommendations.length === 0
      ? CUSTOM_VALUE
      : value

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label htmlFor={`${idPrefix}-select`}>{label}</Label>
        <span className="text-muted-foreground text-xs">
          Default: {defaultModelLabel}
        </span>
      </div>

      <Select
        value={selectValue}
        onValueChange={(next) => {
          if (next === DEFAULT_VALUE) {
            onOverrideChange(false)
            return
          }
          if (next === CUSTOM_VALUE) {
            onOverrideChange(true)
            if (recommendations.includes(value)) onValueChange('')
            return
          }
          onOverrideChange(true)
          onValueChange(next)
        }}
      >
        <SelectTrigger id={`${idPrefix}-select`}>
          <SelectValue placeholder="Select a model" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={DEFAULT_VALUE}>
            Inherit default — {defaultModelLabel}
          </SelectItem>
          {recommendations.map((model) => (
            <SelectItem key={model} value={model}>
              {model}
            </SelectItem>
          ))}
          <SelectItem value={CUSTOM_VALUE}>Custom...</SelectItem>
        </SelectContent>
      </Select>

      {selectValue === CUSTOM_VALUE && (
        <Input
          placeholder={customPlaceholder}
          value={value}
          onChange={(event) => onValueChange(event.target.value)}
        />
      )}

      <div className="flex items-center gap-2">
        <Checkbox
          id={`${idPrefix}-override`}
          checked={override}
          onCheckedChange={(next) => onOverrideChange(next === true)}
        />
        <Label
          htmlFor={`${idPrefix}-override`}
          className="cursor-pointer font-normal text-muted-foreground text-xs"
        >
          Override the global default for this agent
        </Label>
      </div>
    </div>
  )
}
