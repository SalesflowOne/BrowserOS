import { LAST_ROUTE_STORAGE_KEY } from '@company/constants/storage'
import {
  createHashHistory,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'

// Hash history is the only routing mode that works under file:// in
// packaged Electron builds. The default browser history reads
// window.location.pathname, which on file:// is the absolute path of
// index.html on disk — no route matches and the user lands on the
// generic "Not Found" page. Dev mode (vite + portless) wraps the
// renderer in an http origin so the default would have worked there;
// switching universally to hash keeps both environments consistent.
const router = createRouter({
  routeTree,
  history: createHashHistory(),
})

// Persist every resolved route so the next launch can restore where
// the user left off. The index route's beforeLoad reads this value
// and redirects there (see routes/index.tsx). "/" is intentionally
// skipped because it's a redirect bounce — saving it would defeat the
// restore on the very next launch.
router.subscribe('onResolved', ({ toLocation }) => {
  if (toLocation.pathname === '/') return
  try {
    window.localStorage.setItem(
      LAST_ROUTE_STORAGE_KEY,
      toLocation.pathname + toLocation.searchStr,
    )
  } catch {
    // Sandboxed contexts may refuse storage writes. The restore is a
    // nice-to-have; navigation itself must not break here.
  }
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

export function Router() {
  return <RouterProvider router={router} />
}
