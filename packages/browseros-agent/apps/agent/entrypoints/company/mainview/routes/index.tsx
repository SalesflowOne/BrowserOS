import { LAST_ROUTE_STORAGE_KEY } from '@company/constants/storage'
import { createFileRoute, redirect } from '@tanstack/react-router'

// Restore the route the user was on before quitting. Falls back to
// /announcements when no prior route is stored (first launch) or when
// the stored value fails the shape guards below. Routes that point at
// a since-deleted thread / employee still surface as Not Found via
// their own loader — handled separately if needed.
export const Route = createFileRoute('/')({
  beforeLoad: () => {
    const last = readLastRoute()
    if (!last) throw redirect({ to: '/announcements' })
    throw redirect({ to: last.pathname, search: last.search })
  },
})

interface RestoredRoute {
  pathname: string
  search: Record<string, string>
}

// Split the persisted value into the path and an explicit search
// object. TanStack's redirect({ to }) treats `to` as a route
// identifier — an embedded "?..." suffix would either be matched
// literally (no route matches → Not Found) or silently dropped.
// Passing the parsed object via `search` is the only contract that
// preserves params like ?details=open on the thread route.
function readLastRoute(): RestoredRoute | null {
  try {
    const raw = window.localStorage.getItem(LAST_ROUTE_STORAGE_KEY)
    if (!raw) return null
    if (!raw.startsWith('/')) return null
    if (raw === '/') return null
    const questionIdx = raw.indexOf('?')
    if (questionIdx === -1) return { pathname: raw, search: {} }
    const pathname = raw.slice(0, questionIdx)
    const search: Record<string, string> = {}
    for (const [k, v] of new URLSearchParams(raw.slice(questionIdx + 1))) {
      search[k] = v
    }
    return { pathname, search }
  } catch {
    return null
  }
}
