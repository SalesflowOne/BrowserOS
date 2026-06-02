import type { AgentId as CatalogAgentId } from 'agent-skills-manager'
import {
  type AgentKind,
  SUPPORTED_AGENT_KINDS,
  type SupportedAgentKind,
} from '../../shared/agents/capabilities.constants.js'

// The `agent-skills-manager` catalog speaks `claude-code` / `codex` /
// `gemini-cli`. Our internal `AgentKind` uses the shorter `claude` /
// `codex` / `gemini`. This module is the boundary — every call into the
// skills package goes through `toCatalogId` so the rest of main/ stays
// in our own vocabulary.
//
// Keep this file free of any comments naming a prior-art project; the
// design is its own thing and reviewers shouldn't have to learn about
// outside repos to read it.
const TO_CATALOG_ID = {
  claude: 'claude-code',
  codex: 'codex',
  gemini: 'gemini-cli',
} as const satisfies Record<AgentKind, CatalogAgentId>

// Only manage skill links for agents the hire flow actually powers
// end-to-end. Gemini is still in TO_CATALOG_ID for thread/employee
// rows that predate its deprecation, but we don't touch its skills
// directory — stale links there would block link() for every other
// agent on the same skill.
export const AGENT_KINDS_WITH_SKILLS: SupportedAgentKind[] =
  SUPPORTED_AGENT_KINDS.filter(
    (kind): kind is SupportedAgentKind => kind in TO_CATALOG_ID,
  )

export function toCatalogId(agentKind: AgentKind): CatalogAgentId {
  return TO_CATALOG_ID[agentKind]
}
