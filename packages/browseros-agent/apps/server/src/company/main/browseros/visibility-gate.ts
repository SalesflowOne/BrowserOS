import { count, inArray } from 'drizzle-orm'
import { threads } from '../../db/schema/threads.sql.js'
import type { DB } from '../../db/types.js'
import { getChannelOrchestrator } from '../channels/orchestrator.js'
import { getSessionManager } from '../chat/sessionManager.js'
import {
  type AppWindowVisibility,
  type SetAppWindowVisibilityResult,
  setAppWindowVisibility,
} from './app-window.js'

// Thread statuses with in-flight MCP calls bound to the current
// windowId. Toggling visibility (which replaces the window) while in
// these states would strand the in-flight tools.
const BUSY_THREAD_STATUSES = ['streaming', 'awaiting_approval'] as const

export async function isAnyAgentBusy(db: DB): Promise<boolean> {
  const rows = await db
    .select({ n: count() })
    .from(threads)
    .where(inArray(threads.status, [...BUSY_THREAD_STATUSES]))
  const busyThreads = rows[0]?.n ?? 0
  if (busyThreads > 0) return true
  return getChannelOrchestrator().isAnyChannelBusy()
}

export class VisibilityToggleBusyError extends Error {
  constructor() {
    super(
      'Cannot toggle BrowserOS visibility while an agent is running. Stop the active turn first.',
    )
    this.name = 'VisibilityToggleBusyError'
  }
}

// Tabs + tabGroupIds survive a hide/show cycle; only the windowId
// changes. Dispose cached ChatSessions + channel providers so the next
// turn rebuilds its MCP headers against the new windowId.
export async function performVisibilityToggle(
  db: DB,
  browserosMcpUrl: string,
  visibility: AppWindowVisibility,
): Promise<SetAppWindowVisibilityResult> {
  if (await isAnyAgentBusy(db)) {
    throw new VisibilityToggleBusyError()
  }
  // TOCTOU close: re-check right before the upstream flip. The first
  // check + the MCP transport setup spans hundreds of ms; a send that
  // landed in that gap would otherwise build its ChatSession with the
  // pre-flip windowId baked in. Any session that still slips through
  // the remaining μs-scale window is caught by the dispose-all-cached
  // below — its next tool call rebuilds against the new windowId.
  if (await isAnyAgentBusy(db)) {
    throw new VisibilityToggleBusyError()
  }
  const result = await setAppWindowVisibility(db, browserosMcpUrl, visibility)
  await Promise.allSettled([
    getSessionManager().disposeAll(),
    getChannelOrchestrator().disposeProviders(),
  ])
  return result
}
