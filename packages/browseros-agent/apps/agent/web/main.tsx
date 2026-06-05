// Install the chrome/browser shim BEFORE the real app bootstrap evaluates — app
// modules touch chrome.* at import time (sentry, posthog, the BrowserOS adapter).
// ES module evaluation is depth-first in source order, so './shim' fully runs
// before '@/entrypoints/app/main' is evaluated.
import './shim'
import '@/entrypoints/app/main'
