// Module-local singleton holding the URL the main Hono server bound to.
// main/index.ts writes it after `bindHono()` succeeds; consumers (today
// only buildAgentMcpServers, when wiring the in-process nudge MCP into
// the spawned acpx agent) read it back.
//
// Plain mutable string rather than a hook/store because writer + reader
// live in the same Node process and the value is set exactly once at
// boot. The renderer has its own resolution path (see
// mainview/modules/api/client.ts) and doesn't touch this.

let localServerUrl: string | null = null

export function setLocalServerUrl(url: string): void {
  localServerUrl = url
}

// Returns null when the Hono server hasn't bound yet (tests that
// exercise buildAgentMcpServers in isolation, the brief window
// between app start and bindHono completing). Callers that depend on
// the URL should treat null as "skip the in-process MCP entry";
// production always has it set before any chat session runs.
export function getLocalServerUrl(): string | null {
  return localServerUrl
}
