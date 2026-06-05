// Installs a fake `chrome`/`browser` global so the extension UI can boot as a
// plain web page. `@webext-core/fake-browser` provides in-memory storage/tabs/
// runtime; we add the custom BrowserOS + sidePanel surfaces on top.
import { fakeBrowser } from '@webext-core/fake-browser'
import { installBrowserOSStub } from './browseros-stub'

// fake-browser keeps runtime.lastError set to a truthy { message: '' }. The
// BrowserOS adapter treats any truthy lastError as a failure, so expose it as
// undefined (no error) instead.
try {
  Object.defineProperty(fakeBrowser.runtime, 'lastError', {
    get: () => undefined,
    configurable: true,
  })
} catch {
  ;(fakeBrowser.runtime as { lastError?: unknown }).lastError = undefined
}

// The app reads chrome.runtime.getManifest().version at startup (sentry, posthog).
fakeBrowser.runtime.getManifest = () =>
  ({
    version: '0.0.0-web',
    manifest_version: 3,
    name: 'BrowserOS Assistant (web harness)',
  }) as chrome.runtime.Manifest

const chromeShim = fakeBrowser as unknown as typeof chrome
installBrowserOSStub(chromeShim)
// custom chrome.sidePanel.browseros* helpers used by the side-panel toggle util
;(chromeShim as unknown as { sidePanel: unknown }).sidePanel = {
  setOptions: () => Promise.resolve(),
  browserosIsOpen: (cb: (open: boolean) => void) => cb(false),
  browserosToggle: () => {},
}

;(globalThis as { chrome?: typeof chrome }).chrome = chromeShim
;(globalThis as { browser?: unknown }).browser = fakeBrowser
