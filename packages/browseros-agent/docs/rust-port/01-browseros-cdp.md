# browseros-cdp — CDP transport crate

Rust port of `packages/browser-core/src/backends/cdp.ts` + `packages/cdp-protocol`.
Full behavioral contract: [reference/browser-core-inventory.md](./reference/browser-core-inventory.md) §3, §7.

## Responsibilities

- Discover and hold **one browser-level WebSocket** to a running BrowserOS/Chromium
  (`http://{host}:{port}/json/version` → `webSocketDebuggerUrl`), loopback host fallback
  order `127.0.0.1` → `localhost` → `[::1]`, remembering the last successful host.
- Request/response correlation, session routing (flat mode), event fan-out, keepalive,
  reconnect with epoch invalidation.
- Typed protocol structs/wrappers generated at build time — **including the BrowserOS
  custom domains** (`Browser`, `Bookmarks`, `History`) that exist only in our fork.

## Module layout

```
crates/browseros-cdp/
├── build.rs                 # codegen from vendored protocol JSON → OUT_DIR
├── protocol/                # vendored JSON: browser_protocol.json, js_protocol.json,
│                            #   browseros_protocol.json (custom domains)
└── src/
    ├── lib.rs
    ├── client.rs            # CdpClient
    ├── discovery.rs         # /json/version + host fallback
    ├── error.rs             # CdpError (thiserror)
    ├── events.rs            # CdpEvent, subscription handles
    └── generated.rs         # include!(concat!(env!("OUT_DIR"), "/protocol.rs"))
```

The protocol JSON is the **same source** the TS `gen:cdp` codegen consumes
(`scripts/codegen/cdp-protocol.ts`) — extract/copy the custom-domain definitions from
there so both language stacks share one protocol of record.

## CdpClient design (agent-browser pattern + our TS semantics)

```rust
pub struct CdpClient { /* … */ }

impl CdpClient {
    pub async fn connect(opts: ConnectOptions) -> Result<Self, CdpError>;
    pub async fn disconnect(&self);
    pub fn is_connected(&self) -> bool;
    pub fn epoch(&self) -> u64;                       // increments per successful socket open

    pub async fn send(&self, method: &str, params: Value,
                      session: Option<&SessionId>) -> Result<Value, CdpError>;
    pub async fn send_typed<P: Serialize, R: DeserializeOwned>(
        &self, method: &str, params: P, session: Option<&SessionId>) -> Result<R, CdpError>;
    /// Byte-verbatim params passthrough (parse-validated first) — parity with rawSendJson.
    pub async fn send_raw_json(&self, method: &str, params_json: &str,
                               session: Option<&SessionId>) -> Result<String, CdpError>;

    pub fn events(&self) -> broadcast::Receiver<CdpEvent>;      // all events
    pub fn on_event(&self, method: &str) -> EventStream;        // filtered helper
}

pub struct CdpEvent { pub method: String, pub params: Value, pub session_id: Option<SessionId> }
```

Internals (see agent-browser `cli/src/native/cdp/client.rs` for the proven shape):

- Split sink/stream; sink behind `Arc<tokio::sync::Mutex<…>>`.
- `AtomicU64` message ids; pending map `Mutex<HashMap<u64, oneshot::Sender<…>>>`;
  per-request timeout **60s** (TS parity), configurable.
- Reader task: `id` → oneshot; `method` → `broadcast::channel(4096)` of `CdpEvent`.
  On reader exit, **clear the pending map** so callers fail fast.
- Sessions are just a `sessionId` string injected into the outgoing frame
  (`Target.attachToTarget{flatten:true}` world). No per-session channel required at this
  layer; `CdpEvent.session_id` carries identity (this *improves* on the TS layer, where
  session-proxy `.on()` was unfiltered — Rust subscribers filter on `session_id`).
- Keepalive: every 30s send `Browser.getVersion` raced against 10s + WS ping; on failure
  force-close the zombie socket and enter the reconnect path.
- Reconnect: 3 attempts × 5s delay; reject all pending with `CdpError::ConnectionLost`;
  re-run the loop if the fresh socket dies mid-reconnect (`reconnect_requested`);
  `on_reconnect_exhausted` policy enum: `Exit(code)` (TS default) or `KeepTrying`
  — claw-server-rust uses a supervised retry loop instead of exiting.
- Unlimited `max_message_size`/`max_frame_size` (screenshots), tolerate Binary frames.
- TCP `SO_KEEPALIVE` via socket2.

## Error type

```rust
#[derive(thiserror::Error, Debug)]
pub enum CdpError {
    #[error("CDP error: {message}")]           Protocol { code: i64, message: String },
    #[error("CDP request timed out: {method}")] Timeout { method: String },
    #[error("CDP connection lost")]             ConnectionLost,
    #[error("CDP not connected")]               NotConnected,
    #[error("no session with given id")]        SessionGone,
    // …
}
```

`SessionGone`/`ConnectionLost`/`NotConnected` are **typed** so browseros-core's
retry-once logic matches on variants, not strings (TS matched error strings).

## Codegen (build.rs)

- Generate serde structs for domain types + `pub async fn` wrappers per command grouped in
  domain modules (`cdp::browser::get_tabs(client, session, params)` or method-on-client
  style — implementer's choice, keep it mechanical).
- Explicit `Box` table for recursive fields (`DOM.Node.contentDocument`,
  `Runtime.StackTrace.parent`, …) — copy agent-browser's `build.rs` list.
- Generate **only the domains we use** plus the custom ones; everything else goes through
  `send()` untyped. Keep generated code out of git (OUT_DIR).
