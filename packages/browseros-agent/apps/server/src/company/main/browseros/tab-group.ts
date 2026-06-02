import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { eq } from 'drizzle-orm'
import { channels } from '../../db/schema/channels.sql.js'
import { employees } from '../../db/schema/employees.sql.js'
import type { DB } from '../../db/types.js'
import { connectWithTimeout } from '../settings/browseros.js'

// Maps an employee tint to Chromium's tab-group color palette. `teal`
// collapses to `cyan`; everything else maps directly. Unknown tints
// degrade to `grey` so a future palette addition doesn't throw.
export const EMPLOYEE_TINT_TO_GROUP_COLOR: Record<string, string> = {
  orange: 'orange',
  blue: 'blue',
  green: 'green',
  purple: 'purple',
  pink: 'pink',
  teal: 'cyan',
}

const MCP_CLIENT_INFO = {
  name: 'browserclaw-tab-group',
  version: '0.0.1',
} as const

// Placeholder tab opened to seed a new tab group. Chromium tab groups
// must contain at least one tab — a new-tab page is the lightest
// thing that survives the group_tabs call without flashing content
// or making a network request.
const PLACEHOLDER_URL = 'chrome://newtab/'

interface NewPageResult {
  pageId?: number
}
interface GroupTabsResult {
  group?: { groupId?: string }
}
interface ListTabGroupsResult {
  groups?: Array<{ groupId: string; windowId: number; title: string }>
}

function scopeHeaders(scopeId: string): Record<string, string> {
  return {
    'X-BrowserOS-Scope-Id': scopeId,
    'X-BrowserOS-Agent-Id': scopeId,
  }
}

async function withClient<T>(
  browserosMcpUrl: string,
  scopeId: string,
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  const client = new Client(MCP_CLIENT_INFO)
  const transport = new StreamableHTTPClientTransport(
    new URL(browserosMcpUrl),
    {
      requestInit: { headers: scopeHeaders(scopeId) },
    },
  )
  await connectWithTimeout(client, transport)
  try {
    return await fn(client)
  } finally {
    await client.close().catch(() => undefined)
  }
}

export interface TabGroupSurface {
  kind: 'employee' | 'channel'
  id: string
  name: string
  tint: string
}

/**
 * Create a fresh tab group inside the app window. Opens a placeholder
 * chrome://newtab as the seed (Chromium requires ≥1 tab per group),
 * calls group_tabs with the surface's name, then update_tab_group
 * with the tint color. Returns the groupId for persistence.
 *
 * Idempotent at the call site: callers persist the returned id and
 * gate re-creation on whether the row already has one.
 */
export async function createSurfaceTabGroup(
  browserosMcpUrl: string,
  appWindowId: number,
  surface: TabGroupSurface,
): Promise<string> {
  return withClient(browserosMcpUrl, surface.id, async (client) => {
    const created = await client.callTool({
      name: 'new_page',
      arguments: {
        url: PLACEHOLDER_URL,
        background: true,
        windowId: appWindowId,
      },
    })
    const pageId = (created.structuredContent as NewPageResult | undefined)
      ?.pageId
    if (typeof pageId !== 'number') {
      throw new Error('new_page did not return a pageId for placeholder')
    }
    const grouped = await client.callTool({
      name: 'group_tabs',
      arguments: { pageIds: [pageId], title: surface.name },
    })
    const groupId = (grouped.structuredContent as GroupTabsResult | undefined)
      ?.group?.groupId
    if (typeof groupId !== 'string') {
      throw new Error('group_tabs did not return a groupId')
    }
    const color = EMPLOYEE_TINT_TO_GROUP_COLOR[surface.tint] ?? 'grey'
    await client
      .callTool({
        name: 'update_tab_group',
        arguments: { groupId, title: surface.name, color },
      })
      .catch(() => undefined) // color is cosmetic; don't fail the bootstrap
    return groupId
  })
}

// Null out persisted tabGroupIds that no longer exist in BrowserOS so
// the next `ensureSurfaceTabGroup` recreates them. Title-matching the
// orphan to a live group was avoided because surface names aren't
// unique across employees + channels and would collide on a shared
// map.
export async function reconcileTabGroups(
  db: DB,
  browserosMcpUrl: string,
  appWindowId: number,
): Promise<void> {
  return withClient(browserosMcpUrl, 'app-window', async (client) => {
    const result = await client.callTool({
      name: 'list_tab_groups',
      arguments: { windowId: appWindowId },
    })
    const groupIdsAlive = new Set(
      (
        (result.structuredContent as ListTabGroupsResult | undefined)?.groups ??
        []
      ).map((g) => g.groupId),
    )

    const employeeRows = await db
      .select({ id: employees.id, tabGroupId: employees.tabGroupId })
      .from(employees)
    for (const row of employeeRows) {
      if (row.tabGroupId && !groupIdsAlive.has(row.tabGroupId)) {
        await db
          .update(employees)
          .set({ tabGroupId: null })
          .where(eq(employees.id, row.id))
      }
    }

    const channelRows = await db
      .select({ id: channels.id, tabGroupId: channels.tabGroupId })
      .from(channels)
    for (const row of channelRows) {
      if (row.tabGroupId && !groupIdsAlive.has(row.tabGroupId)) {
        await db
          .update(channels)
          .set({ tabGroupId: null })
          .where(eq(channels.id, row.id))
      }
    }
  })
}

export interface EnsureSurfaceTabGroupResult {
  tabGroupId: string
  // True iff the group was (re)created on this call. Callers that
  // cache MCP sessions with the groupId in headers must dispose those
  // sessions when this flips, so the next build rebinds.
  recreated: boolean
}

// Returns the surface's tabGroupId, recreating if the stored id no
// longer points at a live group in BrowserOS.
export async function ensureSurfaceTabGroup(
  db: DB,
  browserosMcpUrl: string,
  appWindowId: number,
  surface: TabGroupSurface,
): Promise<EnsureSurfaceTabGroupResult> {
  const stored = await readStoredTabGroupId(db, surface)
  if (stored) {
    const alive = await isTabGroupAlive(browserosMcpUrl, appWindowId, stored)
    if (alive) return { tabGroupId: stored, recreated: false }
  }
  const created = await createSurfaceTabGroup(
    browserosMcpUrl,
    appWindowId,
    surface,
  )
  await writeSurfaceTabGroupId(db, surface, created)
  return { tabGroupId: created, recreated: true }
}

async function readStoredTabGroupId(
  db: DB,
  surface: TabGroupSurface,
): Promise<string | null> {
  if (surface.kind === 'employee') {
    const rows = await db
      .select({ tabGroupId: employees.tabGroupId })
      .from(employees)
      .where(eq(employees.id, surface.id))
      .limit(1)
    return rows[0]?.tabGroupId ?? null
  }
  const rows = await db
    .select({ tabGroupId: channels.tabGroupId })
    .from(channels)
    .where(eq(channels.id, surface.id))
    .limit(1)
  return rows[0]?.tabGroupId ?? null
}

async function writeSurfaceTabGroupId(
  db: DB,
  surface: TabGroupSurface,
  tabGroupId: string,
): Promise<void> {
  if (surface.kind === 'employee') {
    await db
      .update(employees)
      .set({ tabGroupId })
      .where(eq(employees.id, surface.id))
  } else {
    await db
      .update(channels)
      .set({ tabGroupId })
      .where(eq(channels.id, surface.id))
  }
}

async function isTabGroupAlive(
  browserosMcpUrl: string,
  appWindowId: number,
  tabGroupId: string,
): Promise<boolean> {
  return withClient(browserosMcpUrl, 'app-window', async (client) => {
    const result = await client.callTool({
      name: 'list_tab_groups',
      arguments: { windowId: appWindowId },
    })
    const groups =
      (result.structuredContent as ListTabGroupsResult | undefined)?.groups ??
      []
    return groups.some((g) => g.groupId === tabGroupId)
  })
}
