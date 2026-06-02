import type { AcpxMcpServerConfig } from 'acpx-ai-provider'

/**
 * Builds the scoped BrowserOS MCP server config passed into ACP agents.
 * The URL is supplied by the caller — typically the value the user saved
 * on the General settings tab — so the founder can point at a different
 * BrowserOS host or port without code changes. Default handling lives in
 * `normalizeBrowserosMcpUrl`.
 *
 * `scopeId` controls cookie / storage / login isolation (BrowserOS keeps
 * one profile per Scope-Id). Per-thread chats pass the employeeId so
 * each persona has private state; channels pass the channelId so every
 * member of the channel shares state (Rae's Notion login is inherited
 * by Mira's next turn).
 *
 * `agentId` is the audit identity for tool-call logging and never
 * affects isolation. Threads pass the employee, channels pass the
 * employee too — even when scope is the channel.
 *
 * `windowId` binds every browser tool call this agent makes to the
 * shared app BrowserOS window. The id flows over the wire as the
 * `X-BrowserOS-Default-Window-Id` header; BrowserOS's register-mcp.ts
 * injects it into args.windowId for any tool whose zod input schema has
 * a `windowId` field, and additionally filters out window-mutating
 * tools so the agent can't break the single-window invariant.
 *
 * `tabGroupId` is the per-surface tab group inside that window —
 * created at hire or channel-create time. Same auto-injection pattern
 * via `X-BrowserOS-Default-Tab-Group-Id`, applied to the four
 * page-creating tools (new_page, new_hidden_page, show_page,
 * move_page). Without it, two agents sharing the window would race
 * for whichever group is "active" in Chromium's UI.
 */
export function buildBrowserosMcpServers(
  scopeId: string,
  agentId: string,
  url: string,
  windowId: number | null,
  tabGroupId: string | null,
): AcpxMcpServerConfig[] {
  const headers: Record<string, string> = {
    'X-BrowserOS-Scope-Id': scopeId,
    'X-BrowserOS-Agent-Id': agentId,
  }
  // Number guard: null/undefined both mean "no binding yet" — leaving
  // the header off makes BrowserOS fall back to its default
  // window-targeting behaviour. `String(undefined)` would otherwise
  // serialise to the literal string `"undefined"`.
  if (typeof windowId === 'number') {
    headers['X-BrowserOS-Default-Window-Id'] = String(windowId)
  }
  if (typeof tabGroupId === 'string' && tabGroupId.length > 0) {
    headers['X-BrowserOS-Default-Tab-Group-Id'] = tabGroupId
  }
  return [
    {
      type: 'http',
      name: 'browseros',
      url,
      headers,
    },
  ]
}
