/**
 * @license
 * Copyright 2025 BrowserOS
 */

import { describe, expect, it } from 'bun:test'
import type { AgentSession } from '../../../src/agent/session-store'
import type { ResolvedAgentConfig } from '../../../src/agent/types'
import {
  buildAgentConfigKey,
  ChatService,
} from '../../../src/api/services/chat-service'
import type { ChatRequest } from '../../../src/api/types'

function makeConfig(
  overrides: Partial<ResolvedAgentConfig> = {},
): ResolvedAgentConfig {
  return {
    conversationId: '11111111-1111-4111-8111-111111111111',
    provider: 'browseros',
    model: 'browseros-auto',
    apiKey: 'key-1',
    baseUrl: 'https://api.browseros.com/v1',
    contextWindowSize: 200000,
    supportsImages: true,
    chatMode: false,
    isScheduledTask: false,
    origin: 'sidepanel',
    browserosId: 'browseros-installation-id',
    ...overrides,
  }
}

function makeRequest(overrides: Partial<ChatRequest> = {}): ChatRequest {
  return {
    conversationId: '11111111-1111-4111-8111-111111111111',
    message: 'hello',
    provider: 'browseros',
    model: 'browseros-auto',
    mode: 'agent',
    origin: 'sidepanel',
    supportsImages: true,
    isScheduledTask: false,
    ...overrides,
  }
}

function createChatService(): ChatService {
  return new ChatService({
    sessionStore: {
      get: () => undefined,
      set: () => {},
      remove: () => false,
      delete: async () => false,
      count: () => 0,
    } as unknown as ChatService['deps']['sessionStore'],
    klavisClient: {} as ChatService['deps']['klavisClient'],
    browser: {} as ChatService['deps']['browser'],
    registry: {} as ChatService['deps']['registry'],
  })
}

describe('buildAgentConfigKey', () => {
  it('returns the same key for equivalent configs', () => {
    const first = makeConfig({
      declinedApps: ['slack', 'github'],
    })
    const second = makeConfig({
      declinedApps: ['github', 'slack'],
    })

    expect(buildAgentConfigKey(first)).toBe(buildAgentConfigKey(second))
  })

  it('changes when the provider changes', () => {
    const browserosKey = buildAgentConfigKey(makeConfig())
    const openaiKey = buildAgentConfigKey(
      makeConfig({
        provider: 'openai',
        model: 'gpt-5-mini',
        apiKey: 'openai-key',
        baseUrl: undefined,
        browserosId: undefined,
      }),
    )

    expect(browserosKey).not.toBe(openaiKey)
  })

  it('changes when credentials change for the same provider', () => {
    const first = buildAgentConfigKey(makeConfig({ apiKey: 'key-1' }))
    const second = buildAgentConfigKey(makeConfig({ apiKey: 'key-2' }))

    expect(first).not.toBe(second)
  })

  it('changes when eval mode changes', () => {
    const first = buildAgentConfigKey(makeConfig({ evalMode: false }))
    const second = buildAgentConfigKey(makeConfig({ evalMode: true }))

    expect(first).not.toBe(second)
  })
})

describe('ChatService session invalidation', () => {
  it('rebuilds a session when the material agent config changes', async () => {
    const service = createChatService()
    const currentConfig = makeConfig()
    const nextConfig = makeConfig({
      provider: 'openai',
      model: 'gpt-5-mini',
      apiKey: 'openai-key',
      baseUrl: undefined,
      browserosId: undefined,
    })
    const currentSession = {
      agent: {} as AgentSession['agent'],
      agentConfigKey: buildAgentConfigKey(currentConfig),
      mcpServerKey: '',
      workingDir: undefined,
    } satisfies AgentSession
    const rebuiltSession = {
      ...currentSession,
      agentConfigKey: buildAgentConfigKey(nextConfig),
    } satisfies AgentSession
    let rebuildCalls = 0

    ;(
      service as unknown as {
        rebuildSession: (
          session: AgentSession,
          request: ChatRequest,
          agentConfig: ResolvedAgentConfig,
          mcpServerKey: string,
          agentConfigKey: string,
        ) => Promise<AgentSession>
      }
    ).rebuildSession = async () => {
      rebuildCalls += 1
      return rebuiltSession
    }

    const result = await (
      service as unknown as {
        applySessionChanges: (
          session: AgentSession,
          request: ChatRequest,
          agentConfig: ResolvedAgentConfig,
          agentConfigKey: string,
          mcpServerKey: string,
        ) => Promise<{
          session: AgentSession | undefined
          contextChanges: string[]
        }>
      }
    ).applySessionChanges(
      currentSession,
      makeRequest({ provider: nextConfig.provider, model: nextConfig.model }),
      nextConfig,
      buildAgentConfigKey(nextConfig),
      '',
    )

    expect(rebuildCalls).toBe(1)
    expect(result.session).toBe(rebuiltSession)
    expect(result.contextChanges).toEqual([
      'The user changed the active model configuration during this conversation. Continue with provider openai and model gpt-5-mini.',
    ])
  })

  it('does not rebuild legacy sessions that have no stored config key', async () => {
    const service = createChatService()
    const config = makeConfig()
    let rebuildCalls = 0

    ;(
      service as unknown as {
        rebuildSession: () => Promise<AgentSession>
      }
    ).rebuildSession = async () => {
      rebuildCalls += 1
      throw new Error('rebuildSession should not be called')
    }

    const legacySession = {
      agent: {} as AgentSession['agent'],
      agentConfigKey: undefined,
      mcpServerKey: '',
      workingDir: undefined,
    } satisfies AgentSession

    const result = await (
      service as unknown as {
        applySessionChanges: (
          session: AgentSession,
          request: ChatRequest,
          agentConfig: ResolvedAgentConfig,
          agentConfigKey: string,
          mcpServerKey: string,
        ) => Promise<{
          session: AgentSession | undefined
          contextChanges: string[]
        }>
      }
    ).applySessionChanges(
      legacySession,
      makeRequest(),
      config,
      buildAgentConfigKey(config),
      '',
    )

    expect(rebuildCalls).toBe(0)
    expect(result.session).toBe(legacySession)
    expect(result.contextChanges).toEqual([])
  })
})
