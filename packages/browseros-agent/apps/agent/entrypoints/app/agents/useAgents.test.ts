import { describe, expect, it } from 'bun:test'
import { mapHarnessAgentToEntry } from './agent-harness-types'

describe('mapHarnessAgentToEntry', () => {
  it('maps created harness agents into chat-compatible entries', () => {
    expect(
      mapHarnessAgentToEntry({
        id: 'agent-1',
        name: 'Review bot',
        adapter: 'codex',
        modelId: 'gpt-5.5',
        reasoningEffort: 'medium',
        permissionMode: 'approve-all',
        sessionKey: 'agent:agent-1:main',
        createdAt: 1000,
        updatedAt: 1000,
      }),
    ).toEqual({
      agentId: 'agent-1',
      name: 'Review bot',
      workspace: 'codex:main',
      model: 'gpt-5.5',
      source: 'agent-harness',
    })
  })
})
