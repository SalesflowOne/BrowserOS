import { describe, expect, it } from 'bun:test'
import {
  getDefaultBaseUrlForProviders,
  providerTypeOptions,
} from '../../../lib/llm-providers/providerTemplates'
import { providerFormSchema } from './provider-form-schema'

const baseProviderValues = {
  name: 'Local coding provider',
  modelId: 'default',
  supportsImages: false,
  contextWindow: 128000,
  temperature: 0.2,
}

describe('providerFormSchema', () => {
  it('accepts Codex provider configs without API credentials', () => {
    const result = providerFormSchema.safeParse({
      ...baseProviderValues,
      type: 'codex',
    })

    expect(result.success).toBe(true)
  })

  it('accepts Claude Code provider configs without API credentials', () => {
    const result = providerFormSchema.safeParse({
      ...baseProviderValues,
      type: 'claude-code',
    })

    expect(result.success).toBe(true)
  })

  it('still requires a base URL for ordinary API-backed providers', () => {
    const result = providerFormSchema.safeParse({
      ...baseProviderValues,
      type: 'openai',
    })

    expect(result.success).toBe(false)
  })
})

describe('provider type options', () => {
  it('includes Codex and Claude Code with empty base URL defaults', () => {
    expect(providerTypeOptions).toContainEqual({
      value: 'codex',
      label: 'Codex',
    })
    expect(providerTypeOptions).toContainEqual({
      value: 'claude-code',
      label: 'Claude Code',
    })
    expect(getDefaultBaseUrlForProviders('codex')).toBe('')
    expect(getDefaultBaseUrlForProviders('claude-code')).toBe('')
  })
})
