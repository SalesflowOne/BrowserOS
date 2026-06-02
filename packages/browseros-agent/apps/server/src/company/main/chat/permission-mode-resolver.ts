import type { Thread } from '../../db/schema/threads.sql.js'
import type { DB } from '../../db/types.js'
import {
  DEFAULT_PERMISSION_MODE,
  isPermissionMode,
  type PermissionMode,
} from '../../shared/permission.js'
import { getDefaultPermissionMode } from '../settings/permission.js'

// Reads the effective permission mode for a thread:
//   1. thread.permissionMode column (set at create time from the
//      settings default, then mutated by the chat-header picker).
//   2. settings.permission.defaultMode — fallback for legacy rows
//      whose column is NULL (every thread predating the 0014
//      migration).
//   3. DEFAULT_PERMISSION_MODE constant — final fallback if a
//      future schema migration corrupts the settings row.
//
// Returns one of the four valid PermissionMode strings, never null.
// Tolerates unknown column values (e.g. forward-compat from a future
// build that introduces a new mode) by falling through to the
// settings default.
export async function resolvePermissionMode(
  db: DB,
  thread: Thread,
): Promise<PermissionMode> {
  if (thread.permissionMode && isPermissionMode(thread.permissionMode)) {
    return thread.permissionMode
  }
  const fromSettings = await getDefaultPermissionMode(db)
  return isPermissionMode(fromSettings) ? fromSettings : DEFAULT_PERMISSION_MODE
}
