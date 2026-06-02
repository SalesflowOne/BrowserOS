// In-memory pointer to the thread the renderer reports as currently
// visible. The notification dispatcher reads it together with
// `mainWindow.isFocused()` to decide whether the user is actively
// looking at the thread an event landed on — and therefore whether
// to suppress the toast and bump `lastSeenAt` instead of firing one.
//
// No staleness guard. The OS-level window-focus check (`BrowserWindow.
// isFocused()`) is the canonical signal for "is the app in front";
// this module only narrows it to which thread inside the app is open.
// If the renderer crashes between reports, the worst case is one
// stale routing decision until the user clicks back into a thread or
// the window blurs.

let currentThreadId: string | null = null

export function setCurrentFocus(threadId: string | null): void {
  currentThreadId = threadId
}

export function getCurrentFocus(): { threadId: string | null } {
  return { threadId: currentThreadId }
}
