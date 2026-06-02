import { API_URL_STORAGE_KEY } from '@company/constants/storage'
import { getAgentServerUrl } from '@/lib/browseros/helpers'

// The ported renderer resolves its API base URL synchronously from
// sessionStorage (see mainview/modules/api/client.ts). In the extension the
// BrowserOS agent server port is only known asynchronously (via the
// chrome.browserOS pref or VITE_BROWSEROS_SERVER_PORT), so we resolve it
// here FIRST, stash `${serverUrl}/company` under the same storage key the
// renderer reads, and only then dynamically import the app — guaranteeing
// the api client's module-load snapshot picks up the right base URL.
async function boot(): Promise<void> {
  let base = 'http://127.0.0.1:9100'
  try {
    base = await getAgentServerUrl()
  } catch {
    // BrowserOS pref unavailable (e.g. plain Chrome dev) — fall back to the
    // default server port. The renderer surfaces unreachable-server states.
  }
  try {
    window.sessionStorage.setItem(API_URL_STORAGE_KEY, `${base}/company`)
  } catch {
    // sessionStorage can throw in unusual embedded contexts; the renderer
    // falls back to its default port.
  }
  await import('@company/main')
}

void boot()
