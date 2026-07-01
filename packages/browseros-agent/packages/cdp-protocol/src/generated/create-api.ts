// ── AUTO-GENERATED from CDP protocol. ──
//
// Do not hand-edit the domain listing (`createProtocolApi` body):
// that block is emitted verbatim from a generator against the CDP
// spec. The `createDomainProxy` factory below IS hand-maintained
// and contains a runtime safety net that the generator must NOT
// overwrite; see the "Generator note" comment above `createDomain
// Proxy`. When a generator run is performed, port the guard block
// forward verbatim.

import type { ProtocolApi } from './protocol-api'

export type RawSend = (
  method: string,
  params?: Record<string, unknown>,
) => Promise<unknown>

export type RawOn = (
  event: string,
  handler: (params: unknown) => void,
) => () => void

// Generator note: the metaproperty guard below is a hand-added
// runtime safety net. When regenerating this file, port the guard
// verbatim into the template. Without it, any code that walks a
// domain proxy for JS metaproperties (JSON.stringify, `await`,
// util.inspect, console.log, structured clone, pino / bun loggers)
// synthesises real CDP requests with method names like
// `Runtime.toJSON` or `HeapProfiler.then`, which BrowserOS silently
// drops and our client eventually rejects with
// `CDP request timeout: <Domain>.<meta>` after 30 s.
function createDomainProxy(domain: string, send: RawSend, on: RawOn): unknown {
  return new Proxy(Object.create(null), {
    get(_, method) {
      // Symbol probes (Symbol.iterator, Symbol.toPrimitive,
      // Symbol.for('nodejs.util.inspect.custom'), Symbol.asyncIterator,
      // etc.) never map to real CDP methods. Short-circuit before
      // the catch-all so serialisers and iterators do not fabricate
      // sends.
      if (typeof method !== 'string') return undefined
      if (method === 'on') {
        return (event: string, handler: (params: unknown) => void) =>
          on(`${domain}.${event}`, handler)
      }
      // JSON.stringify probes `.toJSON`. Returning a function that
      // yields a string tag keeps serialisers happy AND produces
      // readable output when a session accidentally lands in a log
      // payload.
      if (method === 'toJSON') return () => `[CDP:${domain}]`
      // `await value` and Promise assimilation probe `.then`. If we
      // returned a function here, `await` would call it, firing a
      // CDP send. Returning undefined tells the runtime the proxy
      // is NOT a thenable. `.catch` and `.finally` are not on the
      // native `await` unwrap path (ECMA only checks `.then`), but
      // is-promise / is-thenable duck-typing helpers, some
      // structured loggers, and test-framework assertion helpers
      // probe them to decide whether to treat the value as a
      // Promise. Guard the full surface.
      if (method === 'then' || method === 'catch' || method === 'finally') {
        return undefined
      }
      // Well-known runtime / DOM introspection touch points. Devtools
      // inspectors, structured-clone, error printers, and template
      // engines all touch a subset of these. CDP method names are
      // camelCase like `enable` / `evaluate` / `getProperties` and
      // never collide with this list.
      if (
        method === 'nodeType' ||
        method === 'nodeName' ||
        method === 'tagName' ||
        method === 'constructor' ||
        method === 'toString' ||
        method === 'valueOf' ||
        method === 'inspect'
      ) {
        return undefined
      }
      return (params?: Record<string, unknown>) =>
        send(`${domain}.${method}`, params)
    },
  })
}

export function createProtocolApi(send: RawSend, on: RawOn): ProtocolApi {
  return {
    Accessibility: createDomainProxy('Accessibility', send, on),
    Animation: createDomainProxy('Animation', send, on),
    Audits: createDomainProxy('Audits', send, on),
    Autofill: createDomainProxy('Autofill', send, on),
    Bookmarks: createDomainProxy('Bookmarks', send, on),
    BackgroundService: createDomainProxy('BackgroundService', send, on),
    BluetoothEmulation: createDomainProxy('BluetoothEmulation', send, on),
    Browser: createDomainProxy('Browser', send, on),
    CSS: createDomainProxy('CSS', send, on),
    CacheStorage: createDomainProxy('CacheStorage', send, on),
    Cast: createDomainProxy('Cast', send, on),
    DOM: createDomainProxy('DOM', send, on),
    DOMDebugger: createDomainProxy('DOMDebugger', send, on),
    DOMSnapshot: createDomainProxy('DOMSnapshot', send, on),
    DOMStorage: createDomainProxy('DOMStorage', send, on),
    DeviceAccess: createDomainProxy('DeviceAccess', send, on),
    DeviceOrientation: createDomainProxy('DeviceOrientation', send, on),
    Emulation: createDomainProxy('Emulation', send, on),
    EventBreakpoints: createDomainProxy('EventBreakpoints', send, on),
    Extensions: createDomainProxy('Extensions', send, on),
    FedCm: createDomainProxy('FedCm', send, on),
    Fetch: createDomainProxy('Fetch', send, on),
    FileSystem: createDomainProxy('FileSystem', send, on),
    HeadlessExperimental: createDomainProxy('HeadlessExperimental', send, on),
    History: createDomainProxy('History', send, on),
    IO: createDomainProxy('IO', send, on),
    IndexedDB: createDomainProxy('IndexedDB', send, on),
    Input: createDomainProxy('Input', send, on),
    Inspector: createDomainProxy('Inspector', send, on),
    LayerTree: createDomainProxy('LayerTree', send, on),
    Log: createDomainProxy('Log', send, on),
    Media: createDomainProxy('Media', send, on),
    Memory: createDomainProxy('Memory', send, on),
    Network: createDomainProxy('Network', send, on),
    Overlay: createDomainProxy('Overlay', send, on),
    PWA: createDomainProxy('PWA', send, on),
    Page: createDomainProxy('Page', send, on),
    Performance: createDomainProxy('Performance', send, on),
    PerformanceTimeline: createDomainProxy('PerformanceTimeline', send, on),
    Preload: createDomainProxy('Preload', send, on),
    Security: createDomainProxy('Security', send, on),
    ServiceWorker: createDomainProxy('ServiceWorker', send, on),
    SmartCardEmulation: createDomainProxy('SmartCardEmulation', send, on),
    Storage: createDomainProxy('Storage', send, on),
    SystemInfo: createDomainProxy('SystemInfo', send, on),
    Target: createDomainProxy('Target', send, on),
    Tethering: createDomainProxy('Tethering', send, on),
    Tracing: createDomainProxy('Tracing', send, on),
    WebAudio: createDomainProxy('WebAudio', send, on),
    WebAuthn: createDomainProxy('WebAuthn', send, on),
    Console: createDomainProxy('Console', send, on),
    Debugger: createDomainProxy('Debugger', send, on),
    HeapProfiler: createDomainProxy('HeapProfiler', send, on),
    Profiler: createDomainProxy('Profiler', send, on),
    Runtime: createDomainProxy('Runtime', send, on),
    Schema: createDomainProxy('Schema', send, on),
  } as unknown as ProtocolApi
}
