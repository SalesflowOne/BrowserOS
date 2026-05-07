import {
  HERMES_SUPPORTED_PROVIDERS,
  type HermesProviderId,
} from '@browseros/shared/constants/hermes'
import type { FC } from 'react'
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

export interface HermesProviderFieldsValue {
  providerType: string
  modelId: string
  apiKey: string
  baseUrl?: string
  /**
   * When true, the user has opted out of inline configuration. The
   * caller should drop providerType/modelId/apiKey from the create
   * payload so the backend falls through to the legacy
   * seedHermesHomeFromGlobal path that copies from `~/.hermes/`.
   */
  useGlobalConfig: boolean
}

export interface HermesProviderFieldsProps {
  value: HermesProviderFieldsValue
  onChange: (next: HermesProviderFieldsValue) => void
}

const DEFAULT_PROVIDER_ID: HermesProviderId = 'openrouter'

export function getInitialHermesProviderFieldsValue(): HermesProviderFieldsValue {
  const def = HERMES_SUPPORTED_PROVIDERS.find(
    (p) => p.id === DEFAULT_PROVIDER_ID,
  )
  return {
    providerType: def?.id ?? HERMES_SUPPORTED_PROVIDERS[0].id,
    modelId: def?.defaultModel ?? '',
    apiKey: '',
    baseUrl: '',
    useGlobalConfig: false,
  }
}

export const HermesProviderFields: FC<HermesProviderFieldsProps> = ({
  value,
  onChange,
}) => {
  const selectedProvider = HERMES_SUPPORTED_PROVIDERS.find(
    (p) => p.id === value.providerType,
  )

  const handleProviderChange = (next: string) => {
    const nextProvider = HERMES_SUPPORTED_PROVIDERS.find((p) => p.id === next)
    if (!nextProvider) return
    // Pre-fill model when the user hasn't typed one OR is still on the
    // previous provider's default — avoids stomping a custom model the
    // user already typed.
    const priorDefault = selectedProvider?.defaultModel ?? ''
    const shouldOverwriteModel =
      !value.modelId || value.modelId === priorDefault
    onChange({
      ...value,
      providerType: next,
      modelId: shouldOverwriteModel ? nextProvider.defaultModel : value.modelId,
    })
  }

  if (value.useGlobalConfig) {
    return (
      <div className="grid gap-2">
        <div className="flex items-center gap-2 text-sm">
          <Checkbox
            id="hermes-use-global-active"
            checked={value.useGlobalConfig}
            onCheckedChange={(next) =>
              onChange({ ...value, useGlobalConfig: next === true })
            }
          />
          <Label htmlFor="hermes-use-global-active" className="font-normal">
            Use my global Hermes config (`~/.hermes/`)
          </Label>
        </div>
        <p className="rounded-md border border-border bg-muted/30 px-3 py-2 text-muted-foreground text-xs">
          Skipping inline configuration. Hermes will read provider, model, and
          API key from your existing <code>~/.hermes/config.yaml</code> the
          first time you chat with this agent.
        </p>
      </div>
    )
  }

  return (
    <div className="grid gap-3">
      <div className="grid gap-2">
        <Label htmlFor="hermes-provider">Provider</Label>
        <Select value={value.providerType} onValueChange={handleProviderChange}>
          <SelectTrigger id="hermes-provider">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {HERMES_SUPPORTED_PROVIDERS.map((provider) => (
              <SelectItem key={provider.id} value={provider.id}>
                {provider.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="hermes-model">Model</Label>
        <Input
          id="hermes-model"
          value={value.modelId}
          onChange={(event) =>
            onChange({ ...value, modelId: event.target.value })
          }
          placeholder={selectedProvider?.defaultModel ?? 'model id'}
        />
      </div>

      <div className="grid gap-2">
        <Label htmlFor="hermes-api-key">API Key</Label>
        <Input
          id="hermes-api-key"
          type="password"
          value={value.apiKey}
          onChange={(event) =>
            onChange({ ...value, apiKey: event.target.value })
          }
          placeholder={selectedProvider?.envKey ?? 'API key'}
          autoComplete="off"
          spellCheck={false}
        />
      </div>

      {selectedProvider?.requiresBaseUrl ? (
        <div className="grid gap-2">
          <Label htmlFor="hermes-base-url">Base URL</Label>
          <Input
            id="hermes-base-url"
            value={value.baseUrl ?? ''}
            onChange={(event) =>
              onChange({ ...value, baseUrl: event.target.value })
            }
            placeholder="https://api.example.com/v1"
            autoComplete="off"
            spellCheck={false}
          />
        </div>
      ) : null}

      <div className="flex items-center gap-2 text-sm">
        <Checkbox
          id="hermes-use-global"
          checked={value.useGlobalConfig}
          onCheckedChange={(next) =>
            onChange({ ...value, useGlobalConfig: next === true })
          }
        />
        <Label
          htmlFor="hermes-use-global"
          className="font-normal text-muted-foreground"
        >
          I&apos;ve already configured Hermes globally (~/.hermes/)
        </Label>
      </div>
    </div>
  )
}
