import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import {
  type ListToolsResult,
  ListToolsResultSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { eq } from 'drizzle-orm'
import { settings } from '../../db/schema/settings.sql.js'
import type { DB } from '../../db/types.js'

export const BROWSEROS_MCP_URL_SETTING_KEY = 'browseros.mcpUrl'
// Sentinel BrowserOS port used as a fallback for the settings UI
// before the first discovery completes. Matches BrowserOS's typical
// default (and browseros-cli's first common port). At runtime the
// real URL comes from ~/.browseros/server.json via the process
// manager's probe; this constant is only what shows up when the DB
// is empty and we haven't talked to BrowserOS yet.
export const AGENT_BROWSEROS_PORT = 9200
export const DEFAULT_BROWSEROS_MCP_URL = `http://127.0.0.1:${AGENT_BROWSEROS_PORT}/mcp`
// Healthy-localhost MCP handshakes complete in well under 50ms. Five
// seconds is a wide safety margin and still sits under the renderer's
// 15s status-poll interval so a degraded BrowserOS produces a clean
// "unreachable" signal on every tick rather than a stuck spinner.
export const BROWSEROS_MCP_CONNECT_TIMEOUT_MS = 5_000
const MCP_CLIENT_INFO = {
  name: 'browserclaw-settings',
  version: '0.0.1',
} as const

// When the company domain runs inside the BrowserOS server binary, the
// browser-automation MCP is the server's OWN /mcp endpoint on the same port
// — there's no external BrowserOS to discover and no port to configure in the
// UI. bootstrapCompany() sets this once at boot from the known server port;
// when set it overrides both the persisted setting and the default. Cleared
// (null) only in standalone/test contexts that talk to an external BrowserOS.
let ownServerMcpUrl: string | null = null

export function setOwnServerMcpUrl(url: string): void {
  ownServerMcpUrl = normalizeBrowserosMcpUrl(url)
}

export function getOwnServerMcpUrl(): string | null {
  return ownServerMcpUrl
}

/**
 * Wraps client.connect with a hard deadline. StreamableHTTPClientTransport
 * uses fetch under the hood and inherits its no-default-timeout behaviour:
 * a wrong port, a non-MCP server on the right port, or a kernel that
 * never responds can stall the connect forever. Without this guard the
 * boot-time status banner can spin indefinitely and the first chat send
 * can hang inside ensureWindowForThread.
 */
export async function connectWithTimeout(
  client: Client,
  transport: StreamableHTTPClientTransport,
  ms = BROWSEROS_MCP_CONNECT_TIMEOUT_MS,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`BrowserOS MCP connect timed out after ${ms}ms`)),
      ms,
    )
  })
  try {
    await Promise.race([client.connect(transport), timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export interface BrowserosMcpTool {
  name: string
  description?: string
}

export interface BrowserosMcpCheck {
  browserosMcpUrl: string
  checkedAt: number
  status: 'reachable' | 'unreachable'
  toolCount: number
  error?: string
}

/**
 * Normalizes the BrowserOS MCP endpoint stored in app settings.
 *
 * Blank values fall back to the local BrowserOS default, and only HTTP(S)
 * endpoints are accepted because MCP clients expect an HTTP transport here.
 */
export function normalizeBrowserosMcpUrl(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return DEFAULT_BROWSEROS_MCP_URL

  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    throw new Error('BrowserOS MCP URL must be an absolute URL')
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('BrowserOS MCP URL must use http or https')
  }

  if (url.pathname !== '/') {
    url.pathname = url.pathname.replace(/\/+$/, '') || '/'
  }
  return url.toString()
}

function normalizeTools(tools: ListToolsResult['tools']): BrowserosMcpTool[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
  }))
}

/** Connects to BrowserOS over streamable HTTP MCP and lists available tools. */
export async function fetchBrowserosMcpTools(
  value: string,
): Promise<BrowserosMcpTool[]> {
  const browserosMcpUrl = normalizeBrowserosMcpUrl(value)
  const client = new Client(MCP_CLIENT_INFO)
  const transport = new StreamableHTTPClientTransport(new URL(browserosMcpUrl))
  const tools: BrowserosMcpTool[] = []
  let cursor: string | undefined

  try {
    await connectWithTimeout(client, transport)
    do {
      const response: ListToolsResult = await client.request(
        {
          method: 'tools/list',
          ...(cursor ? { params: { cursor } } : {}),
        },
        ListToolsResultSchema,
      )
      tools.push(...normalizeTools(response.tools))
      cursor = response.nextCursor
    } while (cursor)
    return tools
  } finally {
    await client.close().catch(() => undefined)
  }
}

/** Checks whether the configured BrowserOS MCP endpoint is reachable. */
export async function checkBrowserosMcpUrl(
  value: string,
): Promise<BrowserosMcpCheck> {
  const browserosMcpUrl = normalizeBrowserosMcpUrl(value)
  const checkedAt = Date.now()
  try {
    const tools = await fetchBrowserosMcpTools(browserosMcpUrl)
    return {
      browserosMcpUrl,
      checkedAt,
      status: 'reachable',
      toolCount: tools.length,
    }
  } catch (err) {
    return {
      browserosMcpUrl,
      checkedAt,
      status: 'unreachable',
      toolCount: 0,
      error: err instanceof Error ? err.message : 'BrowserOS is unreachable',
    }
  }
}

/**
 * Resolves the BrowserOS MCP URL. In the in-binary deployment this is the
 * server's own /mcp (set by bootstrapCompany) and the persisted setting is
 * ignored. Falls back to the persisted setting / default only when running
 * standalone against an external BrowserOS.
 */
export async function getBrowserosMcpUrl(db: DB): Promise<string> {
  if (ownServerMcpUrl) return ownServerMcpUrl
  const rows = await db
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, BROWSEROS_MCP_URL_SETTING_KEY))
    .limit(1)
  return normalizeBrowserosMcpUrl(rows[0]?.value ?? '')
}

/**
 * BrowserOS's klavis HTTP routes (/klavis/servers/add etc.) live on the
 * same agent-server origin as the MCP endpoint, just one level up. Strip
 * the trailing /mcp segment so callers can build sibling URLs without
 * hard-coding the host or duplicating the normalization above.
 */
export async function getBrowserosBaseUrl(db: DB): Promise<string> {
  const url = await getBrowserosMcpUrl(db)
  return url.replace(/\/mcp\/?$/, '')
}

/** Validates and persists the BrowserOS MCP URL for future agent wiring. */
export async function saveBrowserosMcpUrl(
  db: DB,
  value: string,
): Promise<string> {
  const normalized = normalizeBrowserosMcpUrl(value)
  const now = new Date()
  await db
    .insert(settings)
    .values({
      key: BROWSEROS_MCP_URL_SETTING_KEY,
      value: normalized,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value: normalized, updatedAt: now },
    })
  return normalized
}
