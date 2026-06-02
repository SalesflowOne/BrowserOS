import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { eq } from 'drizzle-orm'
import { settings } from '../../db/schema/settings.sql.js'
import type { DB } from '../../db/types.js'
import { connectWithTimeout } from '../settings/browseros.js'
import { restoreElectronFocus } from './electron-focus.js'

// The whole app shares one BrowserOS window. Per-surface (employee,
// channel) state collapses into a single windowId persisted on the
// `settings` row. Each surface gets a tab group inside this one window
// (see tab-group.ts) so cookies + login state are shared across
// surfaces but visual separation in the tab strip is preserved.
//
// Two settings keys:
//   - browseros.appWindowId — integer string, the live windowId
//   - browseros.appWindowVisibility — 'visible' | 'hidden', user toggle

export const APP_WINDOW_ID_SETTING_KEY = 'browseros.appWindowId'
export const APP_WINDOW_VISIBILITY_SETTING_KEY = 'browseros.appWindowVisibility'
export type AppWindowVisibility = 'visible' | 'hidden'

const MCP_CLIENT_INFO = {
  name: 'browserclaw-app-window',
  version: '0.0.1',
} as const

const APP_WINDOW_SCOPE_ID = 'app-window'

interface WindowInfo {
  windowId: number
  isVisible: boolean
}

type WindowsListResult = { windows: WindowInfo[]; count?: number }
type CreateWindowResult = { window: WindowInfo }

function scopeHeaders(): Record<string, string> {
  return {
    'X-BrowserOS-Scope-Id': APP_WINDOW_SCOPE_ID,
    'X-BrowserOS-Agent-Id': APP_WINDOW_SCOPE_ID,
  }
}

async function withClient<T>(
  browserosMcpUrl: string,
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  const client = new Client(MCP_CLIENT_INFO)
  const transport = new StreamableHTTPClientTransport(
    new URL(browserosMcpUrl),
    {
      requestInit: { headers: scopeHeaders() },
    },
  )
  await connectWithTimeout(client, transport)
  try {
    return await fn(client)
  } finally {
    await client.close().catch(() => undefined)
  }
}

async function isWindowAlive(
  client: Client,
  windowId: number,
): Promise<boolean> {
  const result = await client.callTool({ name: 'list_windows', arguments: {} })
  const structured = result.structuredContent as WindowsListResult | undefined
  return Boolean(structured?.windows.find((w) => w.windowId === windowId))
}

async function createWindow(
  client: Client,
  visibility: AppWindowVisibility,
): Promise<number> {
  const result =
    visibility === 'hidden'
      ? await client.callTool({
          name: 'create_hidden_window',
          arguments: {},
        })
      : await client.callTool({ name: 'create_window', arguments: {} })
  await restoreElectronFocus()
  const structured = result.structuredContent as CreateWindowResult | undefined
  const id = structured?.window.windowId
  if (typeof id !== 'number') {
    throw new Error(
      'BrowserOS create_window did not return a windowId in structuredContent',
    )
  }
  return id
}

async function readSettingsRow(
  db: DB,
  key: string,
): Promise<string | undefined> {
  const rows = await db
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, key))
    .limit(1)
  return rows[0]?.value
}

async function writeSettingsRow(
  db: DB,
  key: string,
  value: string,
): Promise<void> {
  const now = new Date()
  await db
    .insert(settings)
    .values({ key, value, updatedAt: now })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value, updatedAt: now },
    })
}

export async function getAppWindowVisibility(
  db: DB,
): Promise<AppWindowVisibility> {
  const raw = await readSettingsRow(db, APP_WINDOW_VISIBILITY_SETTING_KEY)
  return raw === 'hidden' ? 'hidden' : 'visible'
}

export async function getAppWindowId(db: DB): Promise<number | null> {
  const raw = await readSettingsRow(db, APP_WINDOW_ID_SETTING_KEY)
  if (!raw) return null
  const n = Number(raw)
  return Number.isInteger(n) && n > 0 ? n : null
}

/**
 * Idempotent resolve-or-create for the single app window. Stored id
 * alive upstream → reuse. Missing or dead → create fresh in the
 * persisted visibility mode and write the new id.
 */
export async function ensureAppWindow(
  db: DB,
  browserosMcpUrl: string,
): Promise<number> {
  return withClient(browserosMcpUrl, async (client) => {
    const stored = await getAppWindowId(db)
    if (stored !== null && (await isWindowAlive(client, stored))) {
      return stored
    }
    const visibility = await getAppWindowVisibility(db)
    const created = await createWindow(client, visibility)
    await writeSettingsRow(db, APP_WINDOW_ID_SETTING_KEY, String(created))
    return created
  })
}

interface SetWindowVisibilityStructured {
  newWindowId?: number
  previousWindowId?: number
  replaced?: boolean
  window?: { windowId: number }
}

export interface SetAppWindowVisibilityResult {
  newWindowId: number
  previousWindowId: number
  replaced: boolean
}

/**
 * Flip the app window's visibility via BrowserOS's set_window_visibility
 * tool. BrowserOS replaces the underlying Browser on flip, so the
 * returned windowId may differ — persist it before any further MCP
 * call. Also persists the new visibility mode for next boot.
 */
export async function setAppWindowVisibility(
  db: DB,
  browserosMcpUrl: string,
  visibility: AppWindowVisibility,
): Promise<SetAppWindowVisibilityResult> {
  return withClient(browserosMcpUrl, async (client) => {
    const stored = await getAppWindowId(db)
    if (stored === null) {
      throw new Error('No app window to flip — call ensureAppWindow first')
    }
    const result = await client.callTool({
      name: 'set_window_visibility',
      arguments: { windowId: stored, visible: visibility === 'visible' },
    })
    if (result.isError) {
      throw new Error(
        extractToolErrorText(result, 'set_window_visibility returned isError'),
      )
    }
    const sc = result.structuredContent as
      | SetWindowVisibilityStructured
      | undefined
    const newWindowId = sc?.newWindowId ?? sc?.window?.windowId
    if (typeof newWindowId !== 'number') {
      throw new Error(
        'set_window_visibility did not return newWindowId in structuredContent',
      )
    }
    await writeSettingsRow(db, APP_WINDOW_ID_SETTING_KEY, String(newWindowId))
    await writeSettingsRow(db, APP_WINDOW_VISIBILITY_SETTING_KEY, visibility)
    return {
      newWindowId,
      previousWindowId: sc?.previousWindowId ?? stored,
      replaced: sc?.replaced ?? newWindowId !== stored,
    }
  })
}

function extractToolErrorText(result: unknown, fallback: string): string {
  const content =
    typeof result === 'object' &&
    result !== null &&
    'content' in result &&
    Array.isArray((result as { content: unknown }).content)
      ? (result as { content: unknown[] }).content[0]
      : undefined
  if (content && typeof content === 'object' && 'text' in content) {
    return String((content as { text: unknown }).text)
  }
  return fallback
}
