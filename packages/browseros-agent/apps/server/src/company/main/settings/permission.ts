import { eq } from 'drizzle-orm'
import { settings } from '../../db/schema/settings.sql.js'
import type { DB } from '../../db/types.js'
import {
  DEFAULT_PERMISSION_MODE,
  isPermissionMode,
  type PermissionMode,
} from '../../shared/permission.js'

export const DEFAULT_PERMISSION_MODE_SETTING_KEY = 'permission.defaultMode'

/** Reads the app-wide default permission mode from persisted settings. */
export async function getDefaultPermissionMode(
  db: DB,
): Promise<PermissionMode> {
  const rows = await db
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, DEFAULT_PERMISSION_MODE_SETTING_KEY))
    .limit(1)
  const value = rows[0]?.value
  return isPermissionMode(value) ? value : DEFAULT_PERMISSION_MODE
}

/** Persists the app-wide default permission mode. */
export async function saveDefaultPermissionMode(
  db: DB,
  value: PermissionMode,
): Promise<PermissionMode> {
  const now = new Date()
  await db
    .insert(settings)
    .values({
      key: DEFAULT_PERMISSION_MODE_SETTING_KEY,
      value,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value, updatedAt: now },
    })
  return value
}
