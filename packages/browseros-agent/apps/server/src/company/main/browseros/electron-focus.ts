// In the Electron host this re-asserted focus after BrowserOS raised
// itself above the app window. In the BrowserOS server host there is no
// Electron window to refocus, so this is a no-op. Kept as a named export
// so callers (app-window.ts, visibility-gate.ts) don't need to change.
export async function restoreElectronFocus(): Promise<void> {
  // intentionally empty — no host window in the server runtime
}
