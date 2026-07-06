# browseros-core — browser session crate

Rust port of `packages/browser-core` (minus the transport, which is `browseros-cdp`).
Full behavioral contract: [reference/browser-core-inventory.md](./reference/browser-core-inventory.md).

## Responsibilities

Everything the TS `BrowserSession` stack does, structured the same way:

```
BrowserSession
├── PageManager     stable pageId registry ↔ custom Browser.getTabs; lazy attach cache
├── WindowManager   Browser.getWindows/createWindow/…
├── FrameRegistry   OOPIF sessionId routing (Target.attachedToTarget, flatten)
├── Observer        per-page snapshot / refs / diff   (snapshot::{refs, render, diff, roles})
├── Input           click/fill/type/press/hover/scroll/drag/… (input::{keyboard, mouse, geometry})
├── Navigation      goto/back/forward/reload + readyState polling
└── Screenshot      plain + annotated capture, per-page capture mutex
```

Plus the `Browser` facade (listPages/newPage/closePage/screenshot/evaluate/…) and
`content_markdown::build_expression()` (the injected DOM→Markdown walker).

## Module layout

```
crates/browseros-core/src/
├── lib.rs
├── browser.rs               # Browser facade
├── session.rs               # BrowserSession + hooks
├── pages.rs                 # PageManager (THE per-page differentiator — port exactly)
├── windows.rs
├── navigation.rs
├── frames.rs                # FrameRegistry (OOPIF)
├── observer.rs              # Observer orchestration + ref resolution (resolve.rs logic)
├── snapshot/{ax_types,refs,render,diff,roles}.rs
├── input/{mod,keyboard,mouse,geometry}.rs
├── screenshot/{mod,geometry,overlay,queue,frame}.rs
├── content_markdown.rs      # builds the injected JS (assets/content-markdown.js via include_str!)
├── assets/*.js              # injected ES5 scripts, byte-copied from the TS sources
└── error.rs                 # CoreError (thiserror)
```

## Key design points

- **Newtypes**: `PageId(u32)`, `TabId(u32)`, `TargetId(String)`, `SessionId(String)`,
  `FrameId(String)`, `WindowId(i64)`, `Ref(String)` — the TS code confuses these three
  keying schemes in consumers; the Rust type system prevents it.
- **PageManager parity is the product differentiator.** Port exactly: stable pageIds
  minted per unseen target, reconciliation matching by targetId OR tabId (pageId survives
  cross-process navigation), EXCLUDED_URL_PREFIXES filter, epoch-based session-cache
  invalidation, hidden-window cache + revalidation, lazy attach
  (`Target.attachToTarget{flatten:true}` + enable Page/DOM/Runtime/Accessibility +
  `Target.setAutoAttach` for OOPIFs + `Runtime.runIfWaitingForDebugger`).
- **Interior state**: `BrowserSession` is `Clone` (`Arc<Inner>`); registries are
  `tokio::sync::Mutex`/`RwLock`-guarded maps — no actor framework, mirrors the TS shape.
- **Injected JS as assets**: overlay, cursor-augment, content-markdown, geometry helpers
  are ES5 strings in TS — carry them over **byte-identical** as `assets/*.js` +
  `include_str!`, don't rewrite them.
- **Errors**: `CoreError` enum with agent-facing `Display` messages preserved verbatim
  ("Unknown page 3. List pages to see what is open.", "Stale ref e5 (button \"Submit\");
  take a new snapshot."). Variants for `UnknownPage`, `StaleRef`, `DocumentChanged`,
  `SessionLost(#[from] CdpError)`, … `Input::with_page_session_retry` retries once on the
  typed session-loss variants.
- **Snapshot engine**: RefMap fork-on-capture/commit-on-success, stable key
  `documentId\0frameId\0backendNodeId`, nth-occurrence fallback re-resolution,
  check-capture-recheck ≤3 attempts using `frameId:loaderId` document ids, iframe
  stitching depth ≤5, LCS line diff with context radius 3. Port the TS unit tests
  (`refs/render/diff/observer/resolve/keyboard` `.test.ts`) as Rust `#[cfg(test)]` tests —
  they encode the exact expected renderings/diffs.
- **OOPIF asymmetry**: mouse events on the element's frame session in that session's
  coordinates; keyboard events on the page session. Cross-frame drags rejected.
- **Screenshot queue**: per-page-session async mutex (map of `Arc<tokio::sync::Mutex<()>>`);
  overlay tagged with a unique token attribute, removed in a `finally`-equivalent
  (`scopeguard` or explicit); objectGroup-scoped handles released across touched sessions.
- **Polling loops** (readyState 150ms/30s, connection 50ms/5s, tab-ready 100ms×30) via
  `tokio::time`, tolerating transient CDP errors, all bounds in one `timeouts` module.
- **Cancellation**: every public async op takes/propagates a `CancellationToken`
  (tokio-util) — this is what the TS layer lacked (screencast races an uncancellable
  screenshot); the MCP/server layers compose tokens for operator cancel.

## Out of scope (parity with TS)

Network interception, downloads-as-API, emulation — reachable through the
`session.cdp()` escape hatches, same as TS.
