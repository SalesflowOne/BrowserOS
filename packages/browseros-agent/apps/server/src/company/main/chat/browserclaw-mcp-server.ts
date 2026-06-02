import type { AcpxMcpServerConfig } from 'acpx-ai-provider'
import { getLocalServerUrl } from '../local-server-url.js'

export const BROWSERCLAW_THREAD_ID_HEADER = 'X-BrowserClaw-Thread-Id'

/**
 * Builds the AcpxMcpServerConfig entry for the in-process browserclaw
 * MCP server (mounted at /mcp/browserclaw by the Hono router). One
 * tool today — `set_thread_title` — but the namespace is sized for any
 * future first-party tool we want to expose to the LLM (rename other
 * resources, set status, etc.).
 *
 * Thread id is passed as a header so the tool handler can scope its
 * effect to the right thread; acpx-ai-provider@0.0.4's `tool-result`
 * stream part collapses to a status string, so the tool handler must
 * mutate state in-process rather than relying on the LLM-side return
 * payload to carry information back.
 *
 * Returns null when the local server URL hasn't been published yet —
 * tests that exercise buildAgentMcpServers in isolation skip this entry
 * (same convention as buildNudgeMcpServer).
 */
export function buildBrowserClawMcpServer(
  threadId: string,
): AcpxMcpServerConfig | null {
  const baseUrl = getLocalServerUrl()
  if (!baseUrl) return null
  return {
    type: 'http',
    name: 'browserclaw',
    url: `${baseUrl}/mcp/browserclaw`,
    headers: { [BROWSERCLAW_THREAD_ID_HEADER]: threadId },
  }
}
