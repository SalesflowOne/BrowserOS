import { createAgentRegistry } from 'acpx/runtime'

// Hermes ships as the `hermes acp` subcommand rather than a bare binary;
// the override registers it in the registry's id space alongside the
// CLIs acpx already knows about. New entries acpx adds upstream become
// available automatically — no code change here.
const REGISTRY_OVERRIDES: Record<string, string> = { hermes: 'hermes acp' }

// One shared registry instance for every reader (detection, hire-time
// validation, etc.) so they all see the same overrides.
export const agentRegistry = createAgentRegistry({
  overrides: REGISTRY_OVERRIDES,
})

/** Every agent id acpx knows about, including overrides. */
export function listAcpxAgentIds(): string[] {
  return agentRegistry.list()
}
