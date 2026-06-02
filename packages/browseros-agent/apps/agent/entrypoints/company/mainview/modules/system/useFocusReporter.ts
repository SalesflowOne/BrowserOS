import { useReportFocus } from '@company/modules/api/focus.hooks'
import { useLocation } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'

// Extracts the thread id from `/e/<employeeId>/t/<threadId>` route
// shapes. Any other path is treated as "not on a thread."
function activeThreadId(pathname: string): string | null {
  const m = pathname.match(/^\/e\/[^/]+\/t\/([^/]+)$/)
  if (!m) return null
  return m[1] ?? null
}

// Reports the focused thread id to main on every change. Combined
// with `BrowserWindow.isFocused()` on the main side, the dispatcher
// gets a reliable "is the user looking at this thread right now"
// signal without needing a heartbeat — the OS-level window-focus
// check is the canonical liveness probe.
//
// Mounted once at the app root.
export function useFocusReporter(): void {
  const { pathname } = useLocation()
  const [hasOsFocus, setHasOsFocus] = useState<boolean>(() =>
    typeof document === 'undefined' ? true : document.hasFocus(),
  )
  const [isVisible, setIsVisible] = useState<boolean>(() =>
    typeof document === 'undefined'
      ? true
      : document.visibilityState === 'visible',
  )
  const { mutate } = useReportFocus()

  useEffect(() => {
    const onFocus = () => setHasOsFocus(true)
    const onBlur = () => setHasOsFocus(false)
    const onVisibility = () =>
      setIsVisible(document.visibilityState === 'visible')
    window.addEventListener('focus', onFocus)
    window.addEventListener('blur', onBlur)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('blur', onBlur)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  const focusedThreadId =
    hasOsFocus && isVisible ? activeThreadId(pathname) : null

  // Only POST when the derived value actually changes — without the
  // ref guard, every render that recomputes to the same id would
  // fire a redundant mutation.
  const lastReported = useRef<string | null | undefined>(undefined)
  useEffect(() => {
    if (lastReported.current === focusedThreadId) return
    lastReported.current = focusedThreadId
    mutate({ threadId: focusedThreadId })
  }, [focusedThreadId, mutate])
}
