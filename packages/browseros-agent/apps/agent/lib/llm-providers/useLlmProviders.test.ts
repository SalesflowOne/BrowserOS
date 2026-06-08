import { describe, expect, it } from 'bun:test'
import {
  resolveDefaultProviderId,
  resolveSelectedProvider,
} from './provider-selection'
import type { LlmProviderConfig } from './types'

const timestamp = 1000

const providers: LlmProviderConfig[] = [
  {
    id: 'browseros',
    type: 'browseros',
    name: 'BrowserOS',
    modelId: 'browseros-auto',
    supportsImages: true,
    contextWindow: 200000,
    temperature: 0.2,
    createdAt: timestamp,
    updatedAt: timestamp,
  },
  {
    id: 'codex-provider',
    type: 'codex',
    name: 'Codex',
    modelId: 'gpt-5.3-codex',
    supportsImages: false,
    contextWindow: 400000,
    temperature: 0.2,
    createdAt: timestamp,
    updatedAt: timestamp,
  },
  {
    id: 'claude-code-provider',
    type: 'claude-code',
    name: 'Claude Code',
    modelId: 'claude-sonnet-4-6',
    supportsImages: false,
    contextWindow: 200000,
    temperature: 0.2,
    createdAt: timestamp,
    updatedAt: timestamp,
  },
]

describe('resolveSelectedProvider', () => {
  it('selects a Codex provider config by the persisted default id', () => {
    expect(resolveSelectedProvider(providers, 'codex-provider')).toEqual(
      providers[1],
    )
  })

  it('selects a Claude Code provider config by the persisted default id', () => {
    expect(resolveSelectedProvider(providers, 'claude-code-provider')).toEqual(
      providers[2],
    )
  })
})

describe('resolveDefaultProviderId', () => {
  it('keeps a Codex provider id when it exists', () => {
    expect(resolveDefaultProviderId(providers, 'codex-provider')).toBe(
      'codex-provider',
    )
  })

  it('keeps a Claude Code provider id when it exists', () => {
    expect(resolveDefaultProviderId(providers, 'claude-code-provider')).toBe(
      'claude-code-provider',
    )
  })

  it('repairs a stale default id to the first configured provider', () => {
    expect(resolveDefaultProviderId(providers, 'missing-provider')).toBe(
      'browseros',
    )
  })
})
