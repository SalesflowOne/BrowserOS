import type { HarnessAdapterDescriptor } from './agent-harness-types'
import type { CreateAgentRuntime } from './agents-page-types'

export const HERMES_ACP_DOCS_URL =
  'https://hermes-agent.nousresearch.com/docs/user-guide/features/acp'

export interface HermesCliInstallPrompt {
  title: string
  description: string
  docsUrl: string
  installCommand: string
}

/**
 * Returns the blocking install prompt for host-local Hermes ACP.
 * BrowserOS launches `hermes acp`, so a missing host CLI has to be
 * resolved before we create the persisted agent record.
 */
export function getHermesCliInstallPrompt(input: {
  createRuntime: CreateAgentRuntime
  selectedAdapter: HarnessAdapterDescriptor | null | undefined
}): HermesCliInstallPrompt | null {
  const health = input.selectedAdapter?.health
  if (
    input.createRuntime !== 'hermes' ||
    input.selectedAdapter?.id !== 'hermes' ||
    health?.healthy !== false
  ) {
    return null
  }

  const reason = health.reason?.trim()
  return {
    title: 'Hermes CLI not installed',
    description: `${
      reason ? `${reason}. ` : ''
    }Install Hermes normally, then add the ACP extra and make sure hermes is on PATH.`,
    docsUrl: HERMES_ACP_DOCS_URL,
    installCommand: "pip install -e '.[acp]'",
  }
}
