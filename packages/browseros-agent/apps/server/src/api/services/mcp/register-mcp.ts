import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { BrowserSession } from '../../../browser/core/session'
import {
  type BrowserToolDefaults,
  registerBrowserTools,
} from '../../../browser-tools/register'

/** Registers the active BrowserOS browser tools for MCP requests. */
export function registerTools(
  mcpServer: McpServer,
  session: BrowserSession,
  defaults: BrowserToolDefaults = {},
): void {
  registerBrowserTools(mcpServer, session, defaults)
}
