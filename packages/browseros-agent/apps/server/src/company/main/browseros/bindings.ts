import { eq } from 'drizzle-orm'
import { channels } from '../../db/schema/channels.sql.js'
import { employees } from '../../db/schema/employees.sql.js'
import type { DB } from '../../db/types.js'
import { ensureAppWindow } from './app-window.js'

export type BrowserSurface = 'employee' | 'channel'

export interface BrowserBinding {
  scopeId: string
  windowId: number
}

export interface ResolveBrowserBindingArgs {
  surface: BrowserSurface
  surfaceId: string
  db: DB
  browserosMcpUrl: string
}

/**
 * Single shared app window — the surface's scopeId still controls
 * cookie / login isolation upstream, but the windowId is the same
 * for every surface in the app.
 */
export async function resolveBrowserBinding(
  args: ResolveBrowserBindingArgs,
): Promise<BrowserBinding | null> {
  const exists = await surfaceExists(args)
  if (!exists) return null
  const windowId = await ensureAppWindow(args.db, args.browserosMcpUrl)
  return { scopeId: args.surfaceId, windowId }
}

async function surfaceExists(
  args: ResolveBrowserBindingArgs,
): Promise<boolean> {
  if (args.surface === 'employee') {
    const rows = await args.db
      .select({ id: employees.id })
      .from(employees)
      .where(eq(employees.id, args.surfaceId))
      .limit(1)
    return rows.length > 0
  }
  const rows = await args.db
    .select({ id: channels.id })
    .from(channels)
    .where(eq(channels.id, args.surfaceId))
    .limit(1)
  return rows.length > 0
}
