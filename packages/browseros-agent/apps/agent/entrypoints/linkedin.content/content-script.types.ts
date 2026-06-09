export interface LauncherPosition {
  x: number
  y: number
}

export interface LauncherStoredState {
  position: LauncherPosition
  popupOpen: boolean
}

export const STORAGE_KEY_POSITION = 'linkedinChat.position'
export const STORAGE_KEY_POPUP_OPEN = 'linkedinChat.popupOpen'

export const LAUNCHER_SIZE = 52
export const VIEWPORT_MARGIN = 12
export const DRAG_THRESHOLD = 6
