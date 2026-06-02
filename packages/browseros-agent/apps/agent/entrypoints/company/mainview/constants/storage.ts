// Canonical names for every Web Storage key the renderer reads or writes.
// All keys are prefixed with `browserclaw:` to keep them out of the way of
// libraries that may also use storage on the same origin.
//
// If a value here is referenced from a place that can't import this module
// (e.g. the inline script in `src/mainview/index.html`), duplicate the
// literal at the call site and leave a comment pointing back here.

export const API_URL_STORAGE_KEY = 'browserclaw:apiUrl'

// Last route the user resolved to before quitting. Read once on the
// index route's beforeLoad to restore the prior session; updated on
// every resolved navigation (see router.tsx).
export const LAST_ROUTE_STORAGE_KEY = 'browserclaw:lastRoute'
