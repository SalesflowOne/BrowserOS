import { restoreElectronFocus } from './electron-focus.js'

interface ScreencastProxyOptions {
  browserosBaseUrl: string
  windowId: number
  pageId?: number | null
  onMessage: (data: string) => void
  onClose: (reason: string) => void
}

export interface ScreencastProxyHandle {
  close: () => void
}

function toWsUrl(
  browserosBaseUrl: string,
  windowId: number,
  pageId: number | null | undefined,
): string {
  const url = new URL(browserosBaseUrl)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  url.pathname = `${url.pathname.replace(/\/$/, '')}/screencast`
  const params = new URLSearchParams({ windowId: String(windowId) })
  if (typeof pageId === 'number') params.set('pageId', String(pageId))
  url.search = `?${params.toString()}`
  return url.toString()
}

export function openScreencastProxy(
  options: ScreencastProxyOptions,
): ScreencastProxyHandle {
  const wsUrl = toWsUrl(
    options.browserosBaseUrl,
    options.windowId,
    options.pageId,
  )
  let closed = false

  const ws = new WebSocket(wsUrl)
  // BrowserOS sends `connected` right after bringToFront resolves —
  // the first WS message is our cue to refocus Electron. macOS spreads
  // NSApp.activate across ~30ms; the late refocus catches the trailing
  // phase so the user doesn't see BrowserOS blink to the front.
  let focusRestored = false

  ws.onmessage = (event) => {
    if (closed) return
    if (typeof event.data !== 'string') return
    if (!focusRestored) {
      focusRestored = true
      void restoreElectronFocus()
      setTimeout(() => {
        if (closed) return
        void restoreElectronFocus()
      }, 40)
    }
    options.onMessage(event.data)
  }
  ws.onerror = () => {
    if (closed) return
    closed = true
    options.onClose('upstream-error')
  }
  ws.onclose = (event) => {
    if (closed) return
    closed = true
    options.onClose(event.reason || 'upstream-closed')
  }

  return {
    close: () => {
      if (closed) return
      closed = true
      try {
        ws.close()
      } catch {
        // best-effort
      }
    },
  }
}
