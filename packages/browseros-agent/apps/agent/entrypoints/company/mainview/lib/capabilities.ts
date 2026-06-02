// Re-export of the per-agent capability constants under the `@/lib/...`
// alias so renderer components don't need a deep relative path into
// `src/shared/`. The constants file is pure data + types, safe to
// bundle into the renderer.
export {
  AGENT_CAPABILITIES,
  AGENT_KINDS,
  type AgentKind,
  isAgentKind,
} from '../../shared/agents/capabilities.constants'
