import { beforeEach, describe, expect, it } from 'bun:test'
import {
  type ImportHarnessProvidersOptions,
  importHarnessProviders,
} from './harnessMigration'
import type { LlmProviderConfig } from './types'

const AGENT_SERVER_URL = 'http://127.0.0.1:9000'

interface FetchResponse {
  ok: boolean
  json: () => Promise<unknown>
}

function jsonResponse(payload: unknown, ok = true): FetchResponse {
  return {
    ok,
    json: async () => payload,
  }
}

function existingProvider(id: string): LlmProviderConfig {
  return {
    id,
    type: 'anthropic',
    name: id,
    modelId: 'claude-sonnet-4-6',
    supportsImages: true,
    contextWindow: 200000,
    temperature: 0.7,
    createdAt: 1,
    updatedAt: 1,
  }
}

let calls: string[] = []
beforeEach(() => {
  calls = []
})

function fetchSpy(response: FetchResponse): typeof fetch {
  return ((url: RequestInfo | URL) => {
    calls.push(typeof url === 'string' ? url : url.toString())
    return Promise.resolve(response as unknown as Response)
  }) as typeof fetch
}

function throwingFetch(): typeof fetch {
  return (() =>
    Promise.reject(new Error('connection refused'))) as unknown as typeof fetch
}

function opts(extra: Partial<ImportHarnessProvidersOptions> = {}) {
  return {
    now: () => 1000,
    agentServerUrl: AGENT_SERVER_URL,
    ...extra,
  } satisfies ImportHarnessProvidersOptions
}

describe('importHarnessProviders', () => {
  it('returns an empty result when the endpoint yields no candidates', async () => {
    const result = await importHarnessProviders(
      [],
      opts({ fetchImpl: fetchSpy(jsonResponse({ candidates: [] })) }),
    )
    expect(result.added).toEqual([])
    expect(result.skipped).toBe(0)
    expect(result.hadCandidates).toBe(false)
    expect(result.serverReachable).toBe(true)
    expect(calls).toEqual(['http://127.0.0.1:9000/migrations/llm-providers'])
  })

  it('converts claude-code candidates into provider records', async () => {
    const result = await importHarnessProviders(
      [],
      opts({
        fetchImpl: fetchSpy(
          jsonResponse({
            candidates: [
              {
                id: 'harness-claude-1',
                type: 'claude-code',
                name: 'Claude Code',
                modelId: 'claude-sonnet-4-6',
                reasoningEffort: 'medium',
                acpAgentId: 'claude',
              },
            ],
          }),
        ),
      }),
    )
    expect(result.added).toHaveLength(1)
    const added = result.added[0]
    expect(added.id).toBe('harness-claude-1')
    expect(added.type).toBe('claude-code')
    expect(added.modelId).toBe('claude-sonnet-4-6')
    expect(added.reasoningEffort).toBe('medium')
    expect(added.acpAgentId).toBe('claude')
    expect(added.contextWindow).toBe(200000)
    expect(added.acpFixedWorkspacePath).toBe(
      '$HOME/browseros-workspaces/harness-claude-1',
    )
    expect(added.createdAt).toBe(1000)
    expect(result.serverReachable).toBe(true)
  })

  it('sets a 400000-token context window for codex candidates', async () => {
    const result = await importHarnessProviders(
      [],
      opts({
        now: () => 5000,
        fetchImpl: fetchSpy(
          jsonResponse({
            candidates: [
              {
                id: 'harness-codex-2',
                type: 'codex',
                name: 'Codex',
                modelId: 'gpt-5.5',
                acpAgentId: 'codex',
              },
            ],
          }),
        ),
      }),
    )
    expect(result.added[0]?.contextWindow).toBe(400000)
    expect(result.added[0]?.type).toBe('codex')
    expect(result.serverReachable).toBe(true)
  })

  it('skips candidates whose id already exists on the provider list', async () => {
    const result = await importHarnessProviders(
      [existingProvider('harness-claude-1')],
      opts({
        fetchImpl: fetchSpy(
          jsonResponse({
            candidates: [
              {
                id: 'harness-claude-1',
                type: 'claude-code',
                name: 'Claude Code',
                modelId: 'claude-sonnet-4-6',
                acpAgentId: 'claude',
              },
              {
                id: 'harness-codex-2',
                type: 'codex',
                name: 'Codex',
                modelId: 'gpt-5.5',
                acpAgentId: 'codex',
              },
            ],
          }),
        ),
      }),
    )
    expect(result.added.map((p) => p.id)).toEqual(['harness-codex-2'])
    expect(result.skipped).toBe(1)
    expect(result.hadCandidates).toBe(true)
    expect(result.serverReachable).toBe(true)
  })

  it('treats a non-ok response as unreachable so the caller retries later', async () => {
    const result = await importHarnessProviders(
      [],
      opts({ fetchImpl: fetchSpy(jsonResponse({ candidates: [] }, false)) }),
    )
    expect(result.added).toEqual([])
    expect(result.hadCandidates).toBe(false)
    expect(result.serverReachable).toBe(false)
  })

  it('treats a thrown fetch as unreachable without surfacing the error', async () => {
    const result = await importHarnessProviders(
      [],
      opts({ fetchImpl: throwingFetch() }),
    )
    expect(result.added).toEqual([])
    expect(result.serverReachable).toBe(false)
  })

  it('reports reachable+empty distinctly from unreachable (fresh-install case)', async () => {
    // Same result.added shape (empty) but different serverReachable so
    // useLlmProviders can decide whether to set the migration flag.
    const reachable = await importHarnessProviders(
      [],
      opts({ fetchImpl: fetchSpy(jsonResponse({ candidates: [] })) }),
    )
    const unreachable = await importHarnessProviders(
      [],
      opts({ fetchImpl: throwingFetch() }),
    )
    expect(reachable.serverReachable).toBe(true)
    expect(unreachable.serverReachable).toBe(false)
    expect(reachable.added).toEqual([])
    expect(unreachable.added).toEqual([])
  })
})
