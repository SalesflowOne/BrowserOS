import { getBrowserOSAdapter } from './adapter'
import { BROWSEROS_PREFS } from './prefs'

const SIDEPANEL_PATH = 'sidepanel.html'
const openWindowSidePanelIds = new Set<number>()
let sidePanelPerWindow = false
let sidePanelOpenStateListenersRegistered = false

type SidePanelTarget = {
  tabId: number
  windowId: number
}

type SidePanelToggleResult = {
  opened: boolean
}

/** Applies the cached side panel scope and keeps Chromium's global panel options in sync. */
export async function setSidePanelPerWindowPreference(
  perWindow: boolean,
): Promise<void> {
  sidePanelPerWindow = perWindow
  await chrome.sidePanel.setOptions(
    perWindow ? { enabled: true, path: SIDEPANEL_PATH } : { enabled: false },
  )
}

/** Loads the stored side panel scope before user-triggered side panel actions run. */
export async function refreshSidePanelScopePreference(): Promise<void> {
  try {
    const pref = await getBrowserOSAdapter().getPref(
      BROWSEROS_PREFS.SIDE_PANEL_PER_WINDOW,
    )
    await setSidePanelPerWindowPreference(pref?.value === true)
  } catch {
    await setSidePanelPerWindowPreference(false)
  }
}

async function openTabSidePanel({
  tabId,
}: SidePanelTarget): Promise<SidePanelToggleResult> {
  const isAlreadyOpen = await chrome.sidePanel.browserosIsOpen({ tabId })
  if (isAlreadyOpen) {
    return { opened: true }
  }
  return await chrome.sidePanel.browserosToggle({ tabId })
}

async function toggleTabSidePanel({
  tabId,
}: SidePanelTarget): Promise<SidePanelToggleResult> {
  return await chrome.sidePanel.browserosToggle({ tabId })
}

async function openWindowSidePanel({
  windowId,
}: SidePanelTarget): Promise<SidePanelToggleResult> {
  if (!openWindowSidePanelIds.has(windowId)) {
    await chrome.sidePanel.open({ windowId })
    openWindowSidePanelIds.add(windowId)
  }
  return { opened: true }
}

async function toggleWindowSidePanel(
  target: SidePanelTarget,
): Promise<SidePanelToggleResult> {
  if (openWindowSidePanelIds.has(target.windowId)) {
    await chrome.sidePanel.close({ windowId: target.windowId })
    openWindowSidePanelIds.delete(target.windowId)
    return { opened: false }
  }
  return await openWindowSidePanel(target)
}

/** Tracks standard side panel events so window mode can behave like a toggle. */
export function registerSidePanelOpenStateListeners(): void {
  if (sidePanelOpenStateListenersRegistered) return
  sidePanelOpenStateListenersRegistered = true

  chrome.sidePanel.onOpened.addListener((info) => {
    if (info.tabId === undefined) {
      openWindowSidePanelIds.add(info.windowId)
    }
  })

  chrome.sidePanel.onClosed.addListener((info) => {
    if (info.tabId === undefined) {
      openWindowSidePanelIds.delete(info.windowId)
    }
  })
}

/** Opens the configured side panel scope without closing an already-open panel. */
export async function openSidePanel(
  target: SidePanelTarget,
): Promise<SidePanelToggleResult> {
  if (sidePanelPerWindow) {
    return await openWindowSidePanel(target)
  }
  return await openTabSidePanel(target)
}

/** Toggles the configured side panel scope from a toolbar/user gesture. */
export async function toggleSidePanel(
  target: SidePanelTarget,
): Promise<SidePanelToggleResult> {
  if (sidePanelPerWindow) {
    return await toggleWindowSidePanel(target)
  }
  return await toggleTabSidePanel(target)
}
