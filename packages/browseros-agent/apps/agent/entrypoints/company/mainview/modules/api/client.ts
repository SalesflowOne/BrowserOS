import { createApiClient } from '../../../shared/api'
import { PROD_API_PORT } from '../../../shared/api-port'
import { API_URL_STORAGE_KEY } from '../../constants/storage'

// In dev, Electron's main process appends `?apiUrl=…` to the initial
// `win.loadURL` call because the Hono server's port is allocated at
// runtime (see src/main/index.ts). The query string is stripped from
// `window.location` long before this module first evaluates — TanStack
// Router's `/` -> `/org` `beforeLoad` redirect fires during the very
// first render, `history.replaceState`-ing the query away. By the time
// any hook reaches `api.*`, `window.location.search` is empty.
//
// `src/mainview/index.html` runs an inline script during HTML parse —
// before any module evaluates and before the router has a chance to
// redirect — that copies the apiUrl into sessionStorage. We read it
// back here. If we ever do see a fresh `?apiUrl=…` (e.g. on a hard
// reload that arrives with the query still attached), refresh the
// stored value.
//
// In packaged builds (`file://`) there's no query param and both sides
// fall back to PROD_API_PORT.

function isLoopbackUrl(value: string | null | undefined): value is string {
  return !!value && value.startsWith('http://127.0.0.1:')
}

function resolveApiBaseUrl(): string {
  const fallback = `http://127.0.0.1:${PROD_API_PORT}`
  if (typeof window === 'undefined') return fallback

  const fromQuery = new URLSearchParams(window.location.search).get('apiUrl')
  if (isLoopbackUrl(fromQuery)) {
    try {
      window.sessionStorage.setItem(API_URL_STORAGE_KEY, fromQuery)
    } catch {
      // sessionStorage can throw in obscure embedded contexts; the value
      // we're about to return still serves this session, so the failure
      // is informational only.
    }
    return fromQuery
  }

  try {
    const stored = window.sessionStorage.getItem(API_URL_STORAGE_KEY)
    if (isLoopbackUrl(stored)) return stored
  } catch {
    // see above — fall through to PROD_API_PORT
  }

  return fallback
}

type ApiClient = ReturnType<typeof createApiClient>

let cachedBase: string | null = null
let cachedClient: ApiClient | null = null

function getApiClient(): ApiClient {
  const base = resolveApiBaseUrl()
  if (base !== cachedBase || !cachedClient) {
    cachedBase = base
    cachedClient = createApiClient(base)
  }
  return cachedClient
}

// Lazy Proxy: every property access (`api.system.settings.$get`) goes
// through the latest resolved baseUrl rather than the snapshot captured
// at module load. If the URL hasn't actually changed since the previous
// access, we hand back the cached client — so this stays cheap.
// hc itself returns a Proxy, so we forward to it without a `receiver`
// override — passing our own empty target would break hc's path chaining.
export const api = new Proxy({} as ApiClient, {
  get(_target, prop) {
    const client = getApiClient() as unknown as Record<PropertyKey, unknown>
    return client[prop]
  },
})

// Exposed mainly for diagnostics — components shouldn't read this; they
// should call through `api`. Reading this snapshot does not refresh.
export const API_BASE_URL = resolveApiBaseUrl()
