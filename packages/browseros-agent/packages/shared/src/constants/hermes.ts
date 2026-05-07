export const HERMES_AGENT_NAME = 'hermes'
export const HERMES_IMAGE = 'docker.io/nousresearch/hermes-agent:v2026.4.30'
export const HERMES_COMPOSE_PROJECT_NAME = 'browseros-hermes'
export const HERMES_CONTAINER_NAME = `${HERMES_COMPOSE_PROJECT_NAME}-hermes-agent-1`
// Inside the container, /data is the volume mount where per-agent HERMES_HOME
// directories live: /data/agents/harness/<agentId>/home. The host-side
// directory that backs this mount lives under the BrowserOS-managed VM
// state directory (so it's reachable inside the Lima VM via the existing
// vm/ mount); the container sees the same files via /data/agents/harness.
export const HERMES_CONTAINER_DATA_DIR = '/data'
export const HERMES_CONTAINER_HARNESS_DIR = `${HERMES_CONTAINER_DATA_DIR}/agents/harness`

/**
 * Provider IDs surfaced in the Hermes agent-creation form. The string
 * values match Hermes' own provider keys (see hermes_cli/providers.py
 * upstream — `openrouter`, `anthropic`, `openai`, `local` for custom).
 *
 * Bedrock is intentionally NOT in this list yet — it needs multiple
 * env vars (AWS_ACCESS_KEY_ID + secret + region) and a separate UX.
 * Add in a follow-up.
 */
export const HERMES_SUPPORTED_PROVIDERS = [
  {
    id: 'openrouter',
    label: 'OpenRouter',
    envKey: 'OPENROUTER_API_KEY',
    defaultModel: 'anthropic/claude-haiku-4.5',
    requiresBaseUrl: false,
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    envKey: 'ANTHROPIC_API_KEY',
    defaultModel: 'claude-haiku-4-5',
    requiresBaseUrl: false,
  },
  {
    id: 'openai',
    label: 'OpenAI',
    envKey: 'OPENAI_API_KEY',
    defaultModel: 'gpt-5.5-mini',
    requiresBaseUrl: false,
  },
  {
    id: 'custom',
    label: 'Custom (OpenAI-compatible)',
    envKey: 'OPENAI_API_KEY',
    defaultModel: '',
    requiresBaseUrl: true,
  },
] as const

export type HermesProviderId = (typeof HERMES_SUPPORTED_PROVIDERS)[number]['id']
