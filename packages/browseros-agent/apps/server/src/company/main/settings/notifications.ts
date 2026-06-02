import { eq } from 'drizzle-orm'
import { settings } from '../../db/schema/settings.sql.js'
import type { DB } from '../../db/types.js'
import {
  DEFAULT_NOTIFICATION_SETTINGS,
  type NotificationSettings,
} from '../../shared/notifications.js'

const SETTING_KEY = 'notifications'

/** Reads the notification toggles from persisted settings. */
export async function getNotificationSettings(
  db: DB,
): Promise<NotificationSettings> {
  const rows = await db
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, SETTING_KEY))
    .limit(1)
  const raw = rows[0]?.value
  if (!raw) return DEFAULT_NOTIFICATION_SETTINGS
  try {
    const parsed = JSON.parse(raw) as Partial<NotificationSettings>
    return {
      agentActivity:
        typeof parsed.agentActivity === 'boolean'
          ? parsed.agentActivity
          : DEFAULT_NOTIFICATION_SETTINGS.agentActivity,
      sound:
        typeof parsed.sound === 'boolean'
          ? parsed.sound
          : DEFAULT_NOTIFICATION_SETTINGS.sound,
    }
  } catch {
    return DEFAULT_NOTIFICATION_SETTINGS
  }
}

/** Persists a partial notification-settings patch — undefined keys
 *  preserve their current values. */
export async function saveNotificationSettings(
  db: DB,
  patch: Partial<NotificationSettings>,
): Promise<NotificationSettings> {
  const current = await getNotificationSettings(db)
  const next: NotificationSettings = {
    agentActivity: patch.agentActivity ?? current.agentActivity,
    sound: patch.sound ?? current.sound,
  }
  const now = new Date()
  await db
    .insert(settings)
    .values({
      key: SETTING_KEY,
      value: JSON.stringify(next),
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value: JSON.stringify(next), updatedAt: now },
    })
  return next
}
