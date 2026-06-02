// Shared between main process and renderer so both sides agree on
// the shape. The renderer reads this shape from GET /system/settings
// and writes via PATCH; main applies it via app.setLoginItemSettings.

export interface AutostartSettings {
  launchAtLogin: boolean
}

export const DEFAULT_AUTOSTART_SETTINGS: AutostartSettings = {
  launchAtLogin: false,
}
