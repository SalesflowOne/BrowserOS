import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { connectWithTimeout } from '../settings/browseros.js'

const MCP_CLIENT_INFO = {
  name: 'browserclaw-list-tabs',
  version: '0.0.1',
} as const

export interface BrowserTab {
  pageId: number
  tabId: number
  url: string
  title: string
  isActive: boolean
}

interface ListPagesResult {
  pages: Array<{
    pageId: number
    tabId: number
    url: string
    title: string
    isActive: boolean
    windowId?: number
  }>
}

// Internal Chromium URLs never appear in the @-picker.
const EXCLUDED_URL_PREFIXES = [
  'chrome://',
  'chrome-extension://',
  'chrome-untrusted://',
  'chrome-search://',
  'devtools://',
]

export async function listTabsForWindow(
  browserosMcpUrl: string,
  scopeId: string,
  // Unused. BrowserOS reports stale `windowId` on each page during
  // hide/show, so filtering by it returns zero tabs while hidden.
  // We have one app window — every non-chrome tab is ours.
  _windowId: number,
): Promise<BrowserTab[]> {
  const client = new Client(MCP_CLIENT_INFO)
  const transport = new StreamableHTTPClientTransport(
    new URL(browserosMcpUrl),
    {
      requestInit: {
        headers: {
          'X-BrowserOS-Scope-Id': scopeId,
          'X-BrowserOS-Agent-Id': scopeId,
        },
      },
    },
  )
  await connectWithTimeout(client, transport)
  try {
    const result = await client.callTool({
      name: 'list_pages',
      arguments: {},
    })
    const structured = result.structuredContent as ListPagesResult | undefined
    if (!structured) {
      // biome-ignore lint/suspicious/noConsole: BrowserOS's list_pages declares an output schema, so structuredContent is the canonical path; missing it indicates a BrowserOS-side regression we want to surface during debugging
      console.warn(
        '[list-tabs] list_pages returned no structuredContent; tabs will be empty',
      )
    }
    const pages = structured?.pages ?? []
    return pages
      .filter(
        (p) => !EXCLUDED_URL_PREFIXES.some((pre) => p.url.startsWith(pre)),
      )
      .map((p) => ({
        pageId: p.pageId,
        tabId: p.tabId,
        url: p.url,
        title: p.title,
        isActive: p.isActive,
      }))
  } finally {
    await client.close().catch(() => undefined)
  }
}
