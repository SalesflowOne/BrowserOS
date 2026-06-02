// Per-agent capability table, sourced from the verified 2026-05-14
// probe of the locally installed adapters: claude-agent-acp 0.31.4,
// codex-acp 0.12.0, gemini-cli 0.42.0. To refresh:
//
//   cd ~/workbench/openclaw/acpx && pnpm install && pnpm build
//   mkdir -p /tmp/cap-probe && cd /tmp/cap-probe
//   for AGENT in claude codex gemini; do
//     node ~/workbench/openclaw/acpx/dist/cli.js \
//       --format json --verbose "$AGENT" exec "hi" \
//       2>&1 | head -100
//   done
//
// Then diff against this file and update by hand.

export type AgentKind = 'claude' | 'codex' | 'gemini'

export const AGENT_KINDS = ['claude', 'codex', 'gemini'] as const

// What the hire flow can actually power end-to-end. `AGENT_KINDS`
// stays wider so any thread / employee row created against a
// deprecated agent still satisfies the type union on read; this is
// the strict list we expose for new hires (dropdown + POST validator).
// To re-enable a deprecated agent: add the id here and verify its
// AGENT_CAPABILITIES entry, models, and display copy are still
// accurate.
export const SUPPORTED_AGENT_KINDS = ['claude', 'codex'] as const

export type SupportedAgentKind = (typeof SUPPORTED_AGENT_KINDS)[number]

export function isSupportedAgentKind(
  value: string,
): value is SupportedAgentKind {
  return (SUPPORTED_AGENT_KINDS as readonly string[]).includes(value)
}

export interface ModelDef {
  id: string
  label: string
  description?: string
}

export interface AgentCapabilities {
  /** Display name shown in the agent picker. */
  label: string
  /** Whether `session/set_config_option` is implemented at all.
   *  Gemini returns ACP -32601 "Method not found" for the whole method. */
  supportsConfigOption: boolean
  /** Wire configId for the effort knob (claude uses `effort`,
   *  codex uses `reasoning_effort`). Null for agents without one. */
  effortConfigId: 'effort' | 'reasoning_effort' | null
  /** Effort values the picker offers. Ordered low → high. */
  effortValues: readonly string[]
  /** Default effort the agent reports on session/new. */
  defaultEffort: string | null
  /** Models advertised in session/new's models.availableModels. */
  models: readonly ModelDef[]
  /** Default modelId the agent reports on session/new. */
  defaultModelId: string
  /** Permission mode the main process hard-locks at session
   *  creation in v1 (no mode picker yet — most-permissive per agent). */
  defaultPermissionMode: string
  /** Prefix character the picker inserts before the skill name on
   *  selection. Claude/Gemini use `/skillName`; Codex uses `$skillName`.
   *  The picker opens on either `/` or `$` regardless of agent, so users
   *  don't have to remember which one this agent expects. */
  skillCommandPrefix: '/' | '$'
}

export const AGENT_CAPABILITIES: Record<AgentKind, AgentCapabilities> = {
  claude: {
    label: 'Claude',
    supportsConfigOption: true,
    effortConfigId: 'effort',
    effortValues: ['low', 'medium', 'high', 'xhigh', 'max'] as const,
    defaultEffort: 'high',
    models: [
      {
        id: 'default',
        label: 'Default',
        description: 'Opus 4.7 · 1M ctx · Most capable',
      },
      {
        id: 'sonnet',
        label: 'Sonnet',
        description: 'Sonnet 4.6 · Everyday tasks',
      },
      { id: 'haiku', label: 'Haiku', description: 'Haiku 4.5 · Fastest' },
    ],
    defaultModelId: 'default',
    defaultPermissionMode: 'bypassPermissions',
    skillCommandPrefix: '/',
  },
  codex: {
    label: 'Codex',
    supportsConfigOption: true,
    effortConfigId: 'reasoning_effort',
    effortValues: ['low', 'medium', 'high', 'xhigh'] as const,
    defaultEffort: 'medium',
    models: [
      {
        id: 'gpt-5.5',
        label: 'GPT-5.5',
        description: 'Frontier · complex coding, research',
      },
      {
        id: 'gpt-5.4',
        label: 'GPT-5.4',
        description: 'Strong everyday coding',
      },
      {
        id: 'gpt-5.4-mini',
        label: 'GPT-5.4-Mini',
        description: 'Small, fast, cost-efficient',
      },
      {
        id: 'gpt-5.3-codex',
        label: 'GPT-5.3 Codex',
        description: 'Coding-optimized',
      },
      {
        id: 'gpt-5.3-codex-spark',
        label: 'GPT-5.3 Codex Spark',
        description: 'Ultra-fast coding',
      },
      {
        id: 'gpt-5.2',
        label: 'GPT-5.2',
        description: 'Professional work, long-running agents',
      },
    ],
    defaultModelId: 'gpt-5.5',
    defaultPermissionMode: 'full-access',
    skillCommandPrefix: '$',
  },
  gemini: {
    label: 'Gemini CLI',
    supportsConfigOption: false,
    effortConfigId: null,
    effortValues: [],
    defaultEffort: null,
    models: [
      {
        id: 'auto-gemini-3',
        label: 'Auto (Gemini 3)',
        description: 'Routes to gemini-3-pro / -flash',
      },
      {
        id: 'auto-gemini-2.5',
        label: 'Auto (Gemini 2.5)',
        description: 'Routes to gemini-2.5-pro / -flash',
      },
      { id: 'gemini-3-pro-preview', label: 'Gemini 3 Pro' },
      { id: 'gemini-3-flash-preview', label: 'Gemini 3 Flash' },
      { id: 'gemini-3.1-flash-lite-preview', label: 'Gemini 3.1 Flash Lite' },
      { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
      { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
      { id: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite' },
    ],
    defaultModelId: 'gemini-3-flash-preview',
    defaultPermissionMode: 'yolo',
    skillCommandPrefix: '/',
  },
}

export function isAgentKind(value: string): value is AgentKind {
  return (AGENT_KINDS as readonly string[]).includes(value)
}

export function capabilitiesFor(agentKind: string): AgentCapabilities {
  if (isAgentKind(agentKind)) return AGENT_CAPABILITIES[agentKind]
  // Unknown agent (legacy `hermes` employees, or anything not in the
  // v1 trio): fall back to claude defaults so the session still starts.
  return AGENT_CAPABILITIES.claude
}
