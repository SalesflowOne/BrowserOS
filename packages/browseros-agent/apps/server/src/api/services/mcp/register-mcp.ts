import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { BrowserSession } from '../../../browser/core/session'
import {
  type BrowserToolDefaults,
  registerBrowserTools,
} from '../../../tools/browser/register'
import { registerFilesystemMcpTools } from '../../../tools/filesystem/register-mcp'

export interface RegisterToolsDeps extends BrowserToolDefaults {
  browserSession: BrowserSession
  executionDir: string
  isRemoteAgentHarness: boolean
}

/** Registers BrowserOS MCP tools for the current request. */
export function registerTools(
  mcpServer: McpServer,
  deps: RegisterToolsDeps,
): void {
  const defaults = {
    defaultWindowId: deps.defaultWindowId,
    defaultTabGroupId: deps.defaultTabGroupId,
  }

  registerBrowserTools(mcpServer, deps.browserSession, defaults)

  if (deps.isRemoteAgentHarness) {
    registerFilesystemMcpTools(mcpServer, deps.executionDir)
  }
}
