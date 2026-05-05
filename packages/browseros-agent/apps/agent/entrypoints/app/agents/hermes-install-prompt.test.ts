import { describe, expect, it } from 'bun:test'
import {
  getHermesCliInstallPrompt,
  HERMES_ACP_DOCS_URL,
} from './hermes-install-prompt'

describe('getHermesCliInstallPrompt', () => {
  it('prompts for Hermes install when the Hermes adapter health is unhealthy', () => {
    expect(
      getHermesCliInstallPrompt({
        createRuntime: 'hermes',
        selectedAdapter: {
          id: 'hermes',
          name: 'Hermes',
          defaultModelId: 'default',
          defaultReasoningEffort: 'default',
          modelControl: 'best-effort',
          models: [],
          reasoningEfforts: [],
          health: {
            healthy: false,
            reason: 'hermes --version failed: command not found',
            checkedAt: 1000,
          },
        },
      }),
    ).toEqual({
      title: 'Hermes CLI not installed',
      description:
        'hermes --version failed: command not found. Install Hermes with the ACP extra, then make sure hermes is on PATH.',
      docsUrl: HERMES_ACP_DOCS_URL,
      installCommand: "pip install -e '.[acp]'",
    })
  })

  it('does not prompt for healthy or non-Hermes adapter selections', () => {
    const hermesDescriptor = {
      id: 'hermes' as const,
      name: 'Hermes',
      defaultModelId: 'default',
      defaultReasoningEffort: 'default',
      modelControl: 'best-effort' as const,
      models: [],
      reasoningEfforts: [],
      health: { healthy: true, checkedAt: 1000 },
    }

    expect(
      getHermesCliInstallPrompt({
        createRuntime: 'hermes',
        selectedAdapter: hermesDescriptor,
      }),
    ).toBeNull()
    expect(
      getHermesCliInstallPrompt({
        createRuntime: 'codex',
        selectedAdapter: { ...hermesDescriptor, id: 'codex', name: 'Codex' },
      }),
    ).toBeNull()
    expect(
      getHermesCliInstallPrompt({
        createRuntime: 'hermes',
        selectedAdapter: null,
      }),
    ).toBeNull()
    expect(
      getHermesCliInstallPrompt({
        createRuntime: 'hermes',
        selectedAdapter: {
          ...hermesDescriptor,
          id: 'codex' as const,
          name: 'Codex',
          health: { healthy: false, checkedAt: 1000 },
        },
      }),
    ).toBeNull()
  })
})
