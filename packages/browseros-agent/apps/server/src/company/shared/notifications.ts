// Shared between main process and renderer so both sides agree on
// the shape and defaults. Mirrors `shared/permission.ts`. The bun-
// side getNotificationSettings reads + writes the JSON payload in
// the `settings` KV row; the renderer falls back to these defaults
// while the GET /system/settings response is in flight.

export interface NotificationSettings {
  agentActivity: boolean
  sound: boolean
}

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  agentActivity: true,
  sound: true,
}
