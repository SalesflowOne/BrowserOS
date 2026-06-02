// One-slot in-memory queue for renderer-bound navigation requests
// originating in main (notification toast clicks today; future tray
// menu clicks). Pull-based: main writes the path, renderer polls and
// drains. The webContents.send IPC alternative depends on the preload
// bridge being live AND the renderer being mounted at the moment of
// click — both of which can fail silently. Polling is one network
// round-trip per second and survives both failure modes.

let pending: string | null = null

export function setNavigationIntent(path: string): void {
  pending = path
}

/** Returns the pending path and clears the slot. Called by the
 *  renderer's polling hook via GET /system/navigation-intents. */
export function consumeNavigationIntent(): string | null {
  const next = pending
  pending = null
  return next
}
