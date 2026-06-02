import { eq } from 'drizzle-orm'
import { settings } from '../../db/schema/settings.sql.js'
import type { DB } from '../../db/types.js'
import {
  type AutostartSettings,
  DEFAULT_AUTOSTART_SETTINGS,
} from '../../shared/autostart.js'

const SETTING_KEY = 'autostart'

export async function getAutostartSettings(db: DB): Promise<AutostartSettings> {
  const rows = await db
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, SETTING_KEY))
    .limit(1)
  const raw = rows[0]?.value
  if (!raw) return DEFAULT_AUTOSTART_SETTINGS
  try {
    const parsed = JSON.parse(raw) as Partial<AutostartSettings>
    return {
      launchAtLogin:
        typeof parsed.launchAtLogin === 'boolean'
          ? parsed.launchAtLogin
          : DEFAULT_AUTOSTART_SETTINGS.launchAtLogin,
    }
  } catch {
    return DEFAULT_AUTOSTART_SETTINGS
  }
}

/** Persists the autostart preference and immediately applies it via
 *  `app.setLoginItemSettings`. macOS + Windows only; Linux silently
 *  no-ops (Electron's setLoginItemSettings doesn't implement it). */
export async function saveAutostartSettings(
  db: DB,
  patch: Partial<AutostartSettings>,
): Promise<AutostartSettings> {
  const current = await getAutostartSettings(db)
  const next: AutostartSettings = {
    launchAtLogin: patch.launchAtLogin ?? current.launchAtLogin,
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
  await applyLoginItem(next)
  return next
}

/** Re-applies the persisted login-item state to the OS. Called once
 *  at boot so an out-of-band change (user removed the app from Login
 *  Items in System Settings) gets resynced from our DB. */
export async function reapplyLoginItemFromDb(db: DB): Promise<void> {
  const current = await getAutostartSettings(db)
  await applyLoginItem(current)
}

// In the Electron host this drove `app.setLoginItemSettings`. The
// BrowserOS server has no OS login-item concept (its lifecycle is owned
// by Chromium), so applying is a no-op. The preference is still persisted
// in the settings table so the UI toggle round-trips.
async function applyLoginItem(_next: AutostartSettings): Promise<void> {
  // intentionally empty — no login-item integration in the server runtime
}
