import { API_BASE_URL } from '@company/modules/api/client'
import { useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'

// Polls `/system/navigation-intents` once a second and routes to any
// pending path. Main queues the intent on notification toast clicks
// (and future tray clicks); the renderer drains the queue here.
//
// Pull-based instead of IPC because the alternative (preload +
// contextBridge + webContents.send) silently fails when the preload
// isn't loaded, the renderer hasn't mounted, or the BrowserWindow
// was just recreated by `app.on('activate')` on macOS. Polling makes
// the contract trivial: if main queued it, the next tick routes it.
//
// Mounted once at the app root.
const POLL_INTERVAL_MS = 1000

export function useNavigationIntents(): void {
  const navigate = useNavigate()

  useEffect(() => {
    let cancelled = false
    const tick = async () => {
      if (cancelled) return
      try {
        const res = await fetch(`${API_BASE_URL}/system/navigation-intents`)
        if (!res.ok) return
        const { path } = (await res.json()) as { path: string | null }
        if (!path) return
        // The path arrives as the absolute route the user should land
        // on (e.g. `/e/<employeeId>/t/<threadId>`). TanStack Router's
        // `to` accepts the literal string at runtime; the cast keeps
        // its compile-time union happy without enumerating every
        // possible route prefix here.
        void navigate({ to: path as never })
      } catch {
        // Transient network error during boot is harmless — the next
        // tick picks the intent up if it's still in the queue.
      }
    }
    const id = setInterval(tick, POLL_INTERVAL_MS)
    // Drain on mount too so a notification clicked just before the
    // renderer was ready still routes immediately.
    void tick()
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [navigate])
}
