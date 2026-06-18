import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { BrowserSession } from '../../../browser/core/session'
import {
  type BrowserToolDefaults,
  registerBrowserTools,
} from '../../../tools/browser/register'

export interface RegisterToolsDeps extends BrowserToolDefaults {
  browserSession: BrowserSession
}

/** Registers BrowserOS browser tools for MCP requests. */
export function registerTools(
  mcpServer: McpServer,
  deps: RegisterToolsDeps,
): void {
  const defaults = {
    defaultWindowId: deps.defaultWindowId,
    defaultTabGroupId: deps.defaultTabGroupId,
  }

  registerBrowserTools(mcpServer, deps.browserSession, defaults)
}
