import type { AcpxMcpServerConfig } from 'acpx-ai-provider'
import { getLocalServerUrl } from '../local-server-url.js'

export const NUDGE_THREAD_ID_HEADER = 'X-BrowserClaw-Thread-Id'

/**
 * Builds the AcpxMcpServerConfig entry for the in-process nudge MCP
 * server. The URL points at the main Hono server's /mcp/nudge route
 * (same process, loopback hostname). The spawned acpx agent reaches
 * it over HTTP just like any other MCP server.
 *
 * Threads the threadId through as a header so the nudge tool handler
 * can emit `mcp.connect_required` into the right thread's event sink.
 * acpx-ai-provider@0.0.4's `tool-result` stream part collapses to a
 * status string instead of carrying the MCP content payload, so we
 * can't intercept the result on the way out — emitting from the tool
 * handler in-process is the only reliable channel.
 *
 * Returns null when the local server URL hasn't been published yet
 * (tests that exercise buildAgentMcpServers in isolation; the brief
 * boot window before bindHono completes). The caller filters nulls
 * before handing the array to acpx.
 *
 * Named `nudge` so the LLM sees the tool as `nudge/suggest_app_connection`
 * — a different namespace than BrowserOS's `browseros/...` tools.
 */
export function buildNudgeMcpServer(
  threadId: string,
): AcpxMcpServerConfig | null {
  const baseUrl = getLocalServerUrl()
  if (!baseUrl) return null
  return {
    type: 'http',
    name: 'nudge',
    url: `${baseUrl}/mcp/nudge`,
    headers: { [NUDGE_THREAD_ID_HEADER]: threadId },
  }
}
