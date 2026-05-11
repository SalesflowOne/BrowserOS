import { describe, expect, it } from 'bun:test'
import type { HarnessAdapterDescriptor } from './agent-harness-types'
import { getAdapterReadinessAlert } from './new-agent-dialog.helpers'

const baseAdapter: HarnessAdapterDescriptor = {
  id: 'claude',
  name: 'Claude Code',
  defaultModelId: 'default',
  defaultReasoningEffort: 'medium',
  modelControl: 'best-effort',
  models: [],
  reasoningEfforts: [],
}

describe('getAdapterReadinessAlert', () => {
  it('blocks creation and explains the selected unhealthy runtime', () => {
    expect(
      getAdapterReadinessAlert({
        ...baseAdapter,
        health: {
          healthy: false,
          reason: 'Container is stopped. Call start() first.',
          checkedAt: 123,
        },
      }),
    ).toEqual({
      title: 'Claude Code runtime is not ready',
      description: 'Container is stopped. Call start() first.',
    })
  })

  it('does not warn for healthy adapters', () => {
    expect(
      getAdapterReadinessAlert({
        ...baseAdapter,
        health: { healthy: true, checkedAt: 123 },
      }),
    ).toBeNull()
  })
})
