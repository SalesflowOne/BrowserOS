import type { AcpxMcpServerConfig } from 'acpx-ai-provider'
import type { Employee } from '../../db/schema/employees.sql.js'
import type { Thread } from '../../db/schema/threads.sql.js'
import type { DB } from '../../db/types.js'
import { ensureAppWindow } from '../browseros/app-window.js'
import { buildBrowserosMcpServers } from '../browseros/mcp-servers.js'
import { ensureSurfaceTabGroup } from '../browseros/tab-group.js'
import { getBrowserosMcpUrl } from '../settings/browseros.js'
import { readMcpRegistry } from '../settings/mcp-registry.js'
import type { McpServer } from '../settings/mcp-registry.schema.js'
import { buildBrowserClawMcpServer } from './browserclaw-mcp-server.js'
import { buildNudgeMcpServer } from './nudge-mcp-server.js'

/**
 * Combines the always-on BrowserOS MCP entry with the user-managed registry
 * into the array passed to acpx. The BrowserOS URL is whatever the founder
 * saved on the General settings tab (falls back to the local default when
 * unset). BrowserOS is kept first so its tools take precedence on duplicate
 * names — a third-party server can't shadow them by registering an entry
 * with the same name.
 *
 * Resolves the shared app BrowserOS window AND this employee's tab
 * group before building the entry so the outgoing acpx config carries
 * both headers from the very first request. A BrowserOS reachability
 * failure degrades to a config without those headers — the agent
 * still gets the BrowserOS entry; tool calls land in BrowserOS's
 * default fallback. Surfacing a hard error here would block the
 * entire chat session.
 */
export async function buildAgentMcpServers(
  db: DB,
  employee: Employee,
  thread: Thread,
): Promise<AcpxMcpServerConfig[]> {
  const [browserosUrl, stored] = await Promise.all([
    getBrowserosMcpUrl(db),
    readMcpRegistry(db),
  ])
  let windowId: number | null = null
  let tabGroupId: string | null = null
  try {
    windowId = await ensureAppWindow(db, browserosUrl)
    const ensured = await ensureSurfaceTabGroup(db, browserosUrl, windowId, {
      kind: 'employee',
      id: employee.id,
      name: employee.name,
      tint: employee.tint,
    })
    tabGroupId = ensured.tabGroupId
  } catch (err) {
    // biome-ignore lint/suspicious/noConsole: surface the failure once at session-build; chat continues without the headers
    console.warn(
      `[agent-mcp-servers] app-window / tab-group ensure failed for employee ${employee.id}; continuing without headers:`,
      err,
    )
  }
  // Always-on browserclaw nudge MCP — single tool
  // (suggest_app_connection) the LLM calls to render a connect card
  // when a third-party toolkit isn't connected yet. Thread id is
  // passed in headers so the tool handler can emit the connect event
  // into the right thread's sink. Skipped (returns null) when the
  // local server URL hasn't been published yet — tests construct
  // buildAgentMcpServers in isolation without going through
  // bindHono → setLocalServerUrl, so the entry is just absent there.
  const nudge = buildNudgeMcpServer(thread.id)
  // Always-on browserclaw MCP — first-party tools the LLM should be
  // able to call. Today: set_thread_title (rail-friendly conversation
  // titles set on the first reply).
  const internal = buildBrowserClawMcpServer(thread.id)
  return [
    ...buildBrowserosMcpServers(
      employee.id,
      employee.id,
      browserosUrl,
      windowId,
      tabGroupId,
    ),
    ...(nudge ? [nudge] : []),
    ...(internal ? [internal] : []),
    ...stored.map(toAcpxShape),
  ]
}

/**
 * Converts a stored server entry into the shape acpx expects. The persisted
 * env/headers arrays of {name, value} pairs become records here. The array
 * form on disk preserves insertion order; once we hand off to acpx the
 * order no longer matters because acpx looks values up by key.
 */
function toAcpxShape(server: McpServer): AcpxMcpServerConfig {
  if (server.type === 'stdio') {
    return {
      type: 'stdio',
      name: server.name,
      command: server.command,
      args: server.args,
      env: pairsToRecord(server.env),
    }
  }
  return {
    type: server.type,
    name: server.name,
    url: server.url,
    headers: pairsToRecord(server.headers),
  }
}

function pairsToRecord(
  pairs: Array<{ name: string; value: string }>,
): Record<string, string> {
  const record: Record<string, string> = {}
  for (const pair of pairs) record[pair.name] = pair.value
  return record
}
