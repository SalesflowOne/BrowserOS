import { describe, expect, it } from 'bun:test'
import type { LlmProviderConfig } from '@/lib/llm-providers/types'
import {
  decodeTargetValue,
  encodeTargetValue,
  resolveEffectiveDefaultTarget,
} from './default-chat-target.helpers'

const timestamp = 1000

const providers: LlmProviderConfig[] = [
  {
    id: 'browseros',
    type: 'browseros',
    name: 'BrowserOS',
    baseUrl: 'https://api.browseros.com/v1',
    modelId: 'browseros-auto',
    supportsImages: true,
    contextWindow: 200000,
    temperature: 0.2,
    createdAt: timestamp,
    updatedAt: timestamp,
  },
  {
    id: 'anthropic-sonnet',
    type: 'anthropic',
    name: 'Anthropic Sonnet',
    modelId: 'claude-sonnet-4-6',
    apiKey: 'sk-ant',
    supportsImages: true,
    contextWindow: 200000,
    temperature: 0.2,
    createdAt: timestamp,
    updatedAt: timestamp,
  },
]

const unconfiguredQwenProvider: LlmProviderConfig = {
  id: 'qwen-oauth',
  type: 'qwen-code',
  name: 'Qwen Code',
  baseUrl: 'https://coding.dashscope.aliyuncs.com/v1',
  modelId: 'qwen3-coder-plus',
  supportsImages: true,
  contextWindow: 1000000,
  temperature: 0.2,
  createdAt: timestamp,
  updatedAt: timestamp,
}

const agents = [{ id: 'agent-cc-1' }, { id: 'agent-codex-1' }]

describe('resolveEffectiveDefaultTarget', () => {
  it('returns the acp selection when the agent exists', () => {
    expect(
      resolveEffectiveDefaultTarget({
        providers,
        agents,
        selection: { kind: 'acp', id: 'agent-cc-1' },
        defaultProviderId: 'browseros',
      }),
    ).toEqual({ kind: 'acp', id: 'agent-cc-1' })
  })

  it('falls back to the default provider when the acp selection is stale', () => {
    expect(
      resolveEffectiveDefaultTarget({
        providers,
        agents,
        selection: { kind: 'acp', id: 'agent-deleted' },
        defaultProviderId: 'anthropic-sonnet',
      }),
    ).toEqual({ kind: 'llm', id: 'anthropic-sonnet' })
  })

  it('returns the llm selection when the provider exists', () => {
    expect(
      resolveEffectiveDefaultTarget({
        providers,
        agents,
        selection: { kind: 'llm', id: 'anthropic-sonnet' },
        defaultProviderId: 'browseros',
      }),
    ).toEqual({ kind: 'llm', id: 'anthropic-sonnet' })
  })

  it('falls back to the default provider when the llm selection is stale', () => {
    expect(
      resolveEffectiveDefaultTarget({
        providers,
        agents,
        selection: { kind: 'llm', id: 'provider-deleted' },
        defaultProviderId: 'browseros',
      }),
    ).toEqual({ kind: 'llm', id: 'browseros' })
  })

  it('falls back when the llm selection needs Qwen reconfiguration', () => {
    expect(
      resolveEffectiveDefaultTarget({
        providers: [unconfiguredQwenProvider, ...providers],
        agents,
        selection: { kind: 'llm', id: 'qwen-oauth' },
        defaultProviderId: 'anthropic-sonnet',
      }),
    ).toEqual({ kind: 'llm', id: 'anthropic-sonnet' })
  })

  it('resolves a null selection to the default provider', () => {
    expect(
      resolveEffectiveDefaultTarget({
        providers,
        agents,
        selection: null,
        defaultProviderId: 'anthropic-sonnet',
      }),
    ).toEqual({ kind: 'llm', id: 'anthropic-sonnet' })
  })

  it('repairs a stale default provider id to the first provider', () => {
    expect(
      resolveEffectiveDefaultTarget({
        providers,
        agents,
        selection: null,
        defaultProviderId: 'provider-deleted',
      }),
    ).toEqual({ kind: 'llm', id: 'browseros' })
  })

  it('repairs a Qwen default provider id that still needs an API key', () => {
    expect(
      resolveEffectiveDefaultTarget({
        providers: [unconfiguredQwenProvider, ...providers],
        agents,
        selection: null,
        defaultProviderId: 'qwen-oauth',
      }),
    ).toEqual({ kind: 'llm', id: 'browseros' })
  })
})

describe('encodeTargetValue / decodeTargetValue', () => {
  it('round-trips llm and acp selections', () => {
    expect(
      decodeTargetValue(encodeTargetValue({ kind: 'llm', id: 'browseros' })),
    ).toEqual({ kind: 'llm', id: 'browseros' })
    expect(
      decodeTargetValue(encodeTargetValue({ kind: 'acp', id: 'agent-cc-1' })),
    ).toEqual({ kind: 'acp', id: 'agent-cc-1' })
  })

  it('preserves ids that contain separators', () => {
    expect(
      decodeTargetValue(
        encodeTargetValue({ kind: 'acp', id: 'acp:codex:gpt-5.5' }),
      ),
    ).toEqual({ kind: 'acp', id: 'acp:codex:gpt-5.5' })
  })

  it('returns null for malformed values', () => {
    expect(decodeTargetValue('')).toBeNull()
    expect(decodeTargetValue('bogus')).toBeNull()
    expect(decodeTargetValue('http:provider')).toBeNull()
    expect(decodeTargetValue('llm:')).toBeNull()
  })
})
