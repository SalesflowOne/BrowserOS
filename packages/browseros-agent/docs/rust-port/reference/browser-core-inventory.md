# browser-core Inventory (spec for Rust port)

Package root: `packages/browseros-agent/packages/browser-core/`
~5,300 lines of TypeScript. Zero third-party runtime deps — pure workspace code over a raw WebSocket CDP client.

## 1. Directory / file structure

```
browser-core/
├── package.json                  # exports map, workspace deps
├── tsconfig.json
└── src/
    ├── index.ts                  # barrel: CdpBackend, Browser, BrowserSession, TabGroup
    ├── browser.ts                # Browser facade (server/eval callers)
    ├── logger.ts                 # console-backed LoggerInterface
    ├── content-markdown.ts       # injected DOM→Markdown walker script builder
    ├── tab-groups.ts             # TabGroup type only
    ├── backends/
    │   ├── types.ts              # CdpBackend interface + CdpTarget
    │   └── cdp.ts                # concrete WebSocket CDP client (554 LOC)
    └── core/
        ├── connection.ts         # CdpConnection interface, SessionId/FrameId, EXCLUDED_URL_PREFIXES
        ├── session.ts            # BrowserSession orchestrator
        ├── pages.ts              # PageManager: pageId registry + target attach
        ├── windows.ts            # WindowManager
        ├── navigation.ts         # Navigation (goto/reload/back/forward)
        ├── screenshot.ts         # annotated screenshot capture
        ├── screenshot-frame.ts   # frameDepth helper
        ├── screenshot-geometry.ts# rect math, viewport/scroll readers
        ├── screenshot-overlay.ts # injected red-box annotation overlay
        ├── screenshot-queue.ts   # per-session capture mutex
        ├── input/
        │   ├── input.ts          # Input action layer (click/fill/type/...)
        │   ├── keyboard.ts       # key maps, typeText, pressCombo, clearField
        │   ├── mouse.ts          # dispatchClick/Hover/Scroll/Drag primitives
        │   └── geometry.ts       # element center, scrollIntoView, focus, jsClick
        ├── observer/
        │   ├── observer.ts       # Observer: snapshot + diff + ref resolution per page
        │   ├── frames.ts         # FrameRegistry: OOPIF session tracking
        │   ├── resolve.ts        # ref → live backendNodeId (2-tier)
        │   ├── ax-tree.ts        # Accessibility.getFullAXTree wrapper
        │   ├── cursor-augment.ts # injected cursor:pointer/onclick scanner
        │   └── *.test.ts
        └── snapshot/
            ├── ax-types.ts       # local AXNode/AXValue/AXProperty shapes
            ├── refs.ts           # RefMap: stable eN ref allocation
            ├── render.ts         # AX tree → text snapshot renderer
            ├── diff.ts           # LCS line diff of snapshots
            ├── roles.ts          # INTERACTIVE/SKIP/ROOT/VALUE role sets
            └── *.test.ts
```

package.json exposes narrow subpath exports (no barrel except index): `.`, `./browser`, `./backends/cdp`, `./backends/types`, `./content-markdown`, `./core/*`, `./tab-groups`.

## 2. Public API surface

### `Browser` — `src/browser.ts` (facade for server/eval callers)
- `constructor(cdp: CdpBackend)`
- `isCdpConnected(): boolean`
- `get session(): BrowserSession`
- `getActivePageForWindow(windowId): Promise<{targetId, session: ProtocolApi, url}>` (used by screencast)
- `getPageSession(pageId): Promise<{targetId, session, url}>`
- `listPages(): Promise<PageInfo[]>`
- `newPage(url, opts?: {hidden?, background?, windowId?}): Promise<number>` — non-hidden pages routed to a visible window (creates one if none)
- `closePage(page)`
- `resolveTabIds(tabIds: number[]): Promise<Map<tabId, pageId>>`
- `screenshot(page, {format, quality?, fullPage}): Promise<{data: base64, mimeType, devicePixelRatio}>`
- `evaluate(page, expression): Promise<{value?, error?, description?}>` — Runtime.evaluate returnByValue+awaitPromise

### `BrowserSession` — `src/core/session.ts` (the real core)
- `constructor(connection: CdpConnection, hooks: BrowserSessionHooks = {})`
- `readonly pages: PageManager`, `readonly windows: WindowManager`
- `observe(pageId): Observer` — lazily created, cached per pageId
- `input(pageId): Input` — new instance each call, shares page's Observer refs
- `nav(pageId): Navigation`
- `screenshot(pageId, options?): Promise<ScreenshotCaptureResult>` — annotated path
- `cdp(method, params?, sessionId?)`, `cdpJson(method, paramsJson, sessionId?)`, `cdpJsonForPage(pageId, method, paramsJson)` — escape hatches
- `isConnected()`, `dispose()`
- Wires: `Target.detachedFromTarget` → `pages.detachSession(sessionId)`; PageManager `onSessionAttached` → `frames.registerPage` then caller hook.

### `CdpBackend` — `src/backends/cdp.ts`
- `constructor({port, exitOnReconnectFailure? = true})`
- `connect() / disconnect() / isConnected() / connectionEpoch()`
- `getTargets(): Promise<CdpTarget[]>` (CdpTarget = {id,type,title,url,tabId?,windowId?} — tabId/windowId are BrowserOS extensions)
- `session(sessionId): ProtocolApi` — cached session-scoped proxy
- `rawSend(method, params?, sessionId?)`, `rawSendJson(method, paramsJson, sessionId?)`
- `onSessionEvent(event, handler(params, sessionId)): () => void`
- Implements whole ProtocolApi on root connection via Proxy merge.

### Other exports
PageManager/PageInfo/PageSession/PageManagerHooks; WindowManager/WindowInfo/SetWindowVisibilityResult; Navigation; Observer/SnapshotResult; FrameRegistry/FrameTarget; resolveRefEntry/ResolvedElement; fetchAxTree; findCursorHits; Input/ClickOptions/DragResult/ScrollDirection; keyboard: normalizeKey/getKeyInfo/modifierBitmask/typeText/clearField/pressCombo/KeyInfo; mouse: dispatchClick/dispatchHover/dispatchScroll/dispatchDrag/MouseButton; geometry: getElementCenter/scrollIntoView/focusElement/jsClick/getInputValue/callOnElement; snapshot: RefMap/RefEntry/DocumentId/FrameId, renderSnapshot/RenderResult/RenderOptions/IframeStitch, diffSnapshots/diffSnapshotObservations/SnapshotDiff/DiffOptions/SnapshotObservation, role sets, AXNode/AXValue/AXProperty; screenshot: captureScreenshotWithAnnotations + options/result/annotation types, runExclusiveScreenshotCapture; buildContentMarkdownExpression(ContentMarkdownOptions); TabGroup = {groupId, windowId, title, color, collapsed, tabIds}.

## 3. CDP connection management

**No puppeteer/playwright/chrome-remote-interface. Hand-rolled raw CDP client over WebSocket** (`src/backends/cdp.ts`):

1. **Discovery**: HTTP GET `http://{host}:{port}/json/version` over loopback hosts in order `127.0.0.1`, `localhost`, `[::1]` (last-successful remembered). Extracts `webSocketDebuggerUrl`, rewrites hostname to discovered host, connects single browser-level WebSocket. Connect timeout 10s, 3 attempts, 1s delay.
2. **Message protocol**: monotonic messageId; `pending: Map<id, {resolve, reject, timer}>` with 60s per-request timeout. `error` responses reject `CDP error: ${message}`. Messages with `method` but no `id` are events → (a) global handlers, (b) if sessionId present, sessionEventHandlers with (params, sessionId).
3. **Sessions (flat mode)**: session = sessionId string injected into outgoing frame. `session(sessionId)` returns cached ProtocolApi proxy closing over sessionId. CAVEAT: session proxies' `.on()` is the GLOBAL bus — not session-filtered; only `onSessionEvent` carries sessionId.
4. **ProtocolApi**: generated in `@browseros/cdp-protocol` — Proxy per domain; `api.Domain.method(params)` → `send("Domain.method", params)`. 56 domains incl. custom BrowserOS `Browser` domain + `Bookmarks`, `History`.
5. **Keepalive**: every 30s `Browser.getVersion` raced vs 10s timeout; failure → force-close zombie socket → reconnect path.
6. **Reconnect**: on unexpected close — reject all pending ("CDP connection lost"), loop: 3 attempts, 5s delay. If fresh socket closes during a reconnect loop, `reconnectRequested` re-runs the loop. Total failure: `process.exit(1)` if exitOnReconnectFailure (default) else false.
7. **Epoch**: increments each successful socket open; higher layers detect reconnects and invalidate session caches.
8. `rawSendJson` builds frame via string concat so pre-validated params JSON passes byte-for-byte (parse-validated first).

### Target/page/session lifecycle (per-page differentiator)

Pages come from **custom BrowserOS `Browser` CDP domain** (NOT Target.getTargets): `Browser.getTabs({includeHidden})`, `getActiveTab({windowId?})`, `getTabInfo({tabId})`, `createTab({url, background?, windowId?})`, `closeTab`, `activateTab`, `moveTab`, `showTab`, `duplicateTab`, `pinTab/unpinTab`, tab-group CRUD (`getTabGroups`, `createTabGroup`, `updateTabGroup`, `addTabsToGroup`, ...), `getWindows`, `createWindow({hidden})`, `closeWindow`, `activateWindow`, `setWindowVisibility`, `setDownloadBehavior`, `cancelDownload`, permissions. `TabInfo` = {tabId, targetId, url, title, isActive, isLoading, loadProgress, isPinned, isHidden, windowId?, index?, groupId?}.

`PageManager` (`src/core/pages.ts`):
- `pages: Map<pageId, PageInfo>` — stable synthetic pageIds (nextPageId++ from 1) minted per unseen targetId. `list()` reconciles vs `Browser.getTabs`: upsert matched by targetId OR tabId (cross-process navigation gives new targetId but same tabId — pageId survives, old session cache dropped), insert new, delete vanished (fires onPageDetached). URLs in EXCLUDED_URL_PREFIXES (`chrome-extension://`, `chrome-untrusted://`, `chrome-search://`, `devtools://`) filtered. CDP omits windowId for hidden tabs → cached value preserved on update.
- `sessions: Map<targetId, sessionId>` — lazy attach cache. `getSession(pageId)` → ensureConnected (waits ≤5s in 50ms polls; if connectionEpoch changed, clears session cache + hiddenWindowId, forces re-list) → re-list() if pageId unknown → attach(targetId): `Target.attachToTarget({targetId, flatten: true})`, enable `Page/DOM/Runtime/Accessibility` in parallel, cache sessionId, fire onSessionAttached (BrowserSession → FrameRegistry.registerPage → `Target.setAutoAttach({autoAttach: true, waitForDebuggerOnStart: false, flatten: true})` on the page session for OOPIF discovery).
- `detachSession(sessionId)` — reverse lookup, driven by root Target.detachedFromTarget.
- `newPage(url, {background?, hidden?, windowId?, tabGroupId?})` — Browser.createTab, poll getTabInfo ≤30×100ms until `!isLoading || loadProgress >= 1`; optional tab-group add (best effort); mint pageId. Hidden pages route to cached-or-created hidden window (revalidated for visibility).
- `getActive()`, `getActiveSessionForWindow(windowId)`, `refresh(pageId)`, `resolveTabIds`, `close`, `show`, `move`.

`FrameRegistry` (`src/core/observer/frames.ts`) — OOPIF:
- Subscribes root Target.attachedToTarget/detachedFromTarget.
- On iframe target attach: `oopifSessions[frameId(=targetId)] = sessionId` (Chrome reuses frameId as OOPIF targetId, globally unique), `Runtime.runIfWaitingForDebugger` if needed, enable DOM+Accessibility best-effort.
- `resolveFrameTarget(pageId, frameId?)`: main frame → page session `{}` ax params; cross-origin OOPIF → dedicated session `{}`; same-origin iframe → page session with `{frameId}` param.

## 4. Domain operations

| Operation | Where | Approach |
|---|---|---|
| goto/reload | navigation.ts | Page.navigate / Page.reload, poll `document.readyState` every 150ms until "complete" or 30s (teardown errors swallowed) |
| back/forward | navigation.ts | Runtime.evaluate history.back()/forward() + same wait |
| Snapshot (AX) | observer/* + snapshot/* | Accessibility.getFullAXTree per frame; recursive iframe stitching depth ≤5 (DOM.describeNode → child frameId → recurse, splice under `- iframe` line bottom-up); render `- role "name" [states] [ref=eN]` lines; cursor-augment merges non-ARIA interactive els; retry ≤3 if main-frame URL or documentId (frameId:loaderId) changed mid-capture else error "Page document changed during snapshot capture; retry." |
| Snapshot diff | snapshot/diff.ts | LCS line diff, context radius 3, gaps `…`, "N added, M removed"; URL change → full snapshot with urlChanged: true |
| Refs | snapshot/refs.ts | eN refs per actionable node; stable via `documentId\0frameId\0backendNodeId` key; fallback counter when documentId unknown; nth occurrence of (frameId, role, name) recorded for stale re-resolution |
| Ref→element | observer/resolve.ts | tier 1: DOM.resolveNode({backendNodeId}) liveness probe (releases object); tier 2: refetch AX tree, pre-order count (role,name) matches to nth, mutate cached backendNodeId |
| Click | input/* | DOM.scrollIntoViewIfNeeded → center via 3-tier fallback (getContentQuads → getBoxModel → getBoundingClientRect eval) → Input.dispatchMouseEvent moved+pressed+released; no geometry → synthetic this.click() via callFunctionOn. Also clickAt(x,y), clickBackendNode |
| Hover | same | mouseMoved only |
| Fill | input.ts | scrollIntoView → real click to focus (fallback DOM.focus); clear = Cmd/Ctrl+A + Backspace on PAGE session; if value remains, triple-click select-all; typeText per-char on page session. Mouse → frame session, keyboard → page session (OOPIF asymmetry) |
| Type/press | keyboard.ts | typeText: per char keyDown+char+keyUp (`\n` → Enter with `\r` text). pressCombo("Meta+Shift+z"): modifier bitmask Alt=1 Ctrl=2 Meta=4 Shift=8; char text suppressed if Ctrl/Alt/Meta; platform modifier Meta on darwin else Control. Full KEY_MAP with windowsVirtualKeyCodes + aliases |
| Scroll | input.ts | Input.dispatchMouseEvent mouseWheel delta=amount×120 at element center or viewport center (Page.getLayoutMetrics); scrollLegacy verifies scrollX/Y moved, falls back to window.scrollBy eval |
| Drag | input.ts, mouse.ts | moved → pressed → moved(target) → released; cross-frame-session drags rejected |
| Select option | input.ts | callFunctionOn: match option by value or trimmed text, set selectedIndex, dispatch change |
| Check/uncheck | input.ts | read this.checked, click if differs |
| Focus | geometry.ts | DOM.pushNodesByBackendIdsToFrontend → DOM.focus({nodeId}) |
| File upload | input.ts | DOM.setFileInputFiles({files, backendNodeId}) |
| JS dialogs | input.ts | Page.handleJavaScriptDialog({accept, promptText?}) |
| Screenshot plain | browser.ts, screenshot.ts | Page.captureScreenshot({format, fromSurface: true, captureBeyondViewport: fullPage, quality (non-png), clip?}); parallel devicePixelRatio eval |
| Screenshot annotated | screenshot*.ts | snapshot → resolve every ref → getBoundingClientRect per el (objectGroup-scoped, released) → project depth-1 iframe rects via DOM.getFrameOwner + clientLeft/Top → clip → inject red-box overlay DIVs (numbered, z-index max, unique token attr) via Runtime.evaluate → capture → remove overlay in finally → return annotation boxes |
| Screenshot mutex | screenshot-queue.ts | per-page-session promise-chain mutex (WeakMap) — overlay DOM is page-global |
| JS eval | browser.ts | Runtime.evaluate returnByValue+awaitPromise; exceptionDetails → error |
| Content markdown | content-markdown.ts | self-contained ES5 IIFE for Runtime.evaluate: DOM walker → Markdown (headings, lists, tables w/ header detection, code fences w/ language, blockquotes, links/images optional, same-origin iframe recursion, viewport-only filtering, hidden-el skipping) |
| Tabs/windows | pages.ts, windows.ts | entirely via custom Browser.* domain |
| Tab groups | tab-groups.ts + Browser.addTabsToGroup | type + group-assignment on create; full CRUD at protocol level |
| Network/downloads/emulation | NOT in browser-core | protocol surface exists in cdp-protocol; consumers use session.cdp escape hatches |

## 5. Abstractions / errors / events

```
CdpBackend (WebSocket, root ProtocolApi, session proxies)
  └ CdpConnection (interface — injected, host-agnostic)
      └ BrowserSession
          ├ PageManager   (pageId → PageInfo, targetId → sessionId)
          ├ WindowManager
          ├ FrameRegistry (frameId → OOPIF sessionId)
          ├ Observer per pageId (baseline text+url, RefMap, RefScope)
          ├ Input per call
          └ Navigation per call
```

- No Element handles — element identity = backendNodeId + owning session.
- Errors: plain Error with agent-facing prose ("Unknown page 3. List pages to see what is open.", "Stale ref e5 (button \"Submit\"); take a new snapshot."). Extensive best-effort catch{} on enables, overlay removal, releases, scrollIntoView, cursor scan, iframe child capture. `Input.withPageSessionRetry` retries once on errors matching `CDP not connected` / `No target with given id` / `No session with given id` / `Session with given id not found`, refreshing page registry between.
- Events: only three subscriptions — root Target.attachedToTarget, detachedFromTarget (×2: FrameRegistry + BrowserSession→PageManager). Everything else request/response.
- Hooks: `PageManagerHooks { onSessionAttached?(session, pageId, sessionId), onPageDetached?(pageId) }` — host apps attach console/network trackers here.

## 6. Dependencies

Zero npm third-party runtime deps. Workspace: `@browseros/cdp-protocol` (generated typed CDP incl. custom Browser/Bookmarks/History domains; `createProtocolApi(send, on)` Proxy factory — regenerate for Rust from same protocol JSON, see `gen:cdp` script `scripts/codegen/cdp-protocol.ts`), `@browseros/shared` (TIMEOUTS: CDP_CONNECT 10s, CDP_CONNECT_RETRY_DELAY 1s, CDP_RECONNECT_DELAY 5s, CDP_KEEPALIVE_INTERVAL 30s, CDP_KEEPALIVE_TIMEOUT 10s, CDP_REQUEST_TIMEOUT 60s; CDP_LIMITS: CONNECT_MAX_RETRIES 3, RECONNECT_MAX_RETRIES 3; EXIT_CODES.GENERAL_ERROR 1; LoggerInterface).

## 7. Tricky/stateful checklist for the Rust port

1. Connection-epoch invalidation — session caches must never outlive a socket.
2. Reconnect state machine — flags connected/disconnecting/reconnecting/reconnectRequested; queued re-reconnect; stale-onclose guard; pending rejection on close; optional exit(1) policy. Keepalive doubles as zombie-socket detector.
3. Session event fan-out caveat — session proxies share global bus; only onSessionEvent carries sessionId.
4. pageId stability across process swaps — tabId matching when targetId changes; agent-facing contract.
5. Ref stability — RefMap.forkForSnapshot() (commit on success), stable-key reuse, fallback counter, reserved-ref skipping, reset on documentId/URL change; capture is check-capture-recheck ≤3 attempts using frameId:loaderId documentIds from Page.getFrameTree.
6. OOPIF asymmetry — mouse on frame session in that session's coords; keyboard on page session. Annotation projection depth-1 only.
7. Screenshot mutex per page session; overlay tagged by unique token attr; objectGroup-scoped handles released in finally across all touched sessions.
8. Polling loops — waitForLoad (150ms/30s), waitForConnection (50ms/5s ×2 places), newPage tab-ready (100ms×30), all tolerating transient CDP errors.
9. One-shot session-error retry via string matching — Rust should use typed error variants.
10. resolveRefEntry mutates entry.backendNodeId in place; RefMap entries shared mutable state.
11. Injected-script hygiene — cursor scan tags `data-__bcid` then removes; overlay removed in finally; ES5 IIFEs, no page-context deps.
12. hiddenWindowId cached + revalidated; cleared on reconnect.
13. rawSendJson byte-verbatim params passthrough.
