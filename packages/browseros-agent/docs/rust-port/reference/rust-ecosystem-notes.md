# Rust ecosystem research (July 2026) — for BrowserOS Rust port

## agent-browser (vercel-labs) deep dive

- NOT a Cargo workspace — single crate at `cli/`, pnpm monorepo around it. Thin CLI ⇄ persistent daemon over Unix socket, NDJSON.
- CDP crate: NONE. Hand-rolled: tokio-tungstenite 0.24 (rustls) + serde_json + build.rs codegen from vendored `browser_protocol.json`/`js_protocol.json` into OUT_DIR, with explicit Box table for recursive fields (DOM.Node.contentDocument, Runtime.StackTrace.parent, ...).
- CdpClient pattern (cli/src/native/cdp/client.rs) — COPY WHOLESALE:
  - split WS sink/stream; sink behind Arc<Mutex>
  - AtomicU64 command ids; Arc<Mutex<HashMap<u64, oneshot::Sender<CdpMessage>>>> pending map
  - reader task: id → oneshot; method → broadcast::channel(4096) of CdpEvent {method, params, session_id}
  - second raw broadcast channel (unparsed text + sessionId) → DevTools inspect proxy
  - per-command 30s timeout; on reader exit pending map CLEARED so callers fail fast
  - WS Ping every 30s (cancelled via watch channel) + TCP SO_KEEPALIVE via socket2 (survive LB idle timeouts)
  - accepts Binary frames (Browserless); unlimited max_message_size/max_frame_size (screenshots)
  - send_command_typed<P: Serialize, R: DeserializeOwned>(method, params, session_id)
- Attach flow (native/browser.rs ~490–640): Target.setDiscoverTargets{discover:true} → getTargets → attachToTarget{flatten:true} per page target; per-session Page.enable, Runtime.enable, Runtime.runIfWaitingForDebugger (Chrome 144+ pauses targets after attach!), Network.enable, then Target.setAutoAttach{autoAttach:true, waitForDebuggerOnStart:false, flatten:true} for OOPIF per-session ids. Target filter: page/webview only, exclude chrome://, chrome-extension://, devtools://.
- Stable agent-facing ids: t1, t2... tabs + optional labels; "teaching errors" on bare ints. @e1 element refs from AX snapshots.
- MCP: hand-rolled stdio JSON-RPC, protocol 2025-11-25, ~90 tools, paginated tools/list (64/page). Tool calls delegate to same binary --json mode. (They predate rmcp maturity — we should use rmcp.)
- Errors: Result<T, String> everywhere + to_ai_friendly_error() mapping layer ("Element exists but is not visible. Wait for it..."). Copy the AI-friendly mapping, NOT the String errors.
- [profile.release] lto=true, codegen-units=1, strip=true; [profile.ci] inherits release w/ thin LTO.
- Daemon redirects stderr to /dev/null or debug log via dup2 (broken pipe can't kill daemon).

## CDP ecosystem verdict

- chromiumoxide 0.9.1 (Feb 2026): async tokio-only; Handler event-loop future you must spawn/poll; launch-centric; single maintainer. Its abstractions fight a long-lived reconnecting server. Could use `chromiumoxide_cdp` types-only crate.
- headless_chrome 1.0.22: SYNC, threads — non-starter under axum + rmcp; frames support missing.
- RECOMMENDED: raw CDP à la agent-browser (tokio-tungstenite 0.29 + serde + own codegen). Critical since BrowserOS has CUSTOM CDP domains (Browser, Bookmarks, History) no third-party crate knows about. ~500 LOC, proven in prod by Vercel.
- Flatten-session gotchas: Target.setAutoAttach NOT recursive (A→B→C: setAutoAttach on B's session to reach C); non-flatten deprecated; always Runtime.runIfWaitingForDebugger after attach (Chrome 144+).

## MCP SDK verdict

- rmcp 2.1.0 (2026-07-02) — official, 14.7M downloads, no real competition. v2.0.0 (2026-06-29) breaking realignment to MCP 2025-11-25 spec (migration: rust-sdk discussion #926). Pin rmcp = "2.1".
- Tools: #[tool_router] on impl, #[tool(description)] per method → Result<CallToolResult, ErrorData>, typed args via Parameters<T> (T: Deserialize + schemars::JsonSchema; doc comments → schema descriptions); #[tool_handler] wires ServerHandler. Also #[prompt_router], tasks, elicitation, structured output.
- Transports feature-gated: transport-io (stdio), transport-streamable-http-server (+-session) — tower service: `Router::new().nest_service("/mcp", StreamableHttpService::new(|| Ok(MyServer::new()), LocalSessionManager::default().into(), config))`. Uses schemars 1.0, thiserror 2, tracing.
- Caveat: fast-moving majors — pin minor.

## Workspace conventions (uv, turborepo, vector verified)

- `crates/` dir + product-prefixed names (uv: crates/uv-*, turborepo: crates/turborepo-*).
- Root virtual manifest: [workspace.package] (edition 2024, rust-version, license), [workspace.dependencies] incl. ALL internal crates as path deps, [workspace.lints.rust]/[workspace.lints.clippy] + `[lints] workspace = true` per member.
  - uv lints: unsafe_code=warn, unreachable_pub=warn, pedantic priority=-2 w/ allows, print_stdout/print_stderr/dbg_macro=warn (forces tracing).
  - turborepo: unwrap_used=deny, expect_used=deny.
- Profiles ONLY in root: [profile.release] lto="thin", codegen-units=1, strip=true.
- Errors: thiserror enum per lib crate (inner errors become #[from] variants upward); anyhow ONLY in binaries.
- Observability: tracing in libs; tracing-subscriber (registry + EnvFilter::try_from_default_env + fmt) init once in binary; stdio MCP mode → logs to stderr only.
- HTTP: axum 0.8; rmcp streamable-HTTP nests into axum Router (MCP + REST + health on one listener).

## Pinned deps (July 2026)

```toml
[workspace.dependencies]
tokio = { version = "1.52", features = ["rt-multi-thread", "macros", "net", "io-util", "time", "sync", "signal", "process"] }
tokio-tungstenite = { version = "0.29", features = ["rustls-tls-webpki-roots"] }
futures-util = "0.3"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
rmcp = { version = "2.1", features = ["server", "transport-io", "transport-streamable-http-server"] }
schemars = "1.0"
axum = "0.8"
tower = "0.5"
reqwest = { version = "0.12", default-features = false, features = ["json", "rustls-tls-webpki-roots"] }
thiserror = "2"
anyhow = "1"
tracing = "0.1"
tracing-subscriber = { version = "0.3", features = ["env-filter"] }
socket2 = "0.6"
url = "2"
base64 = "0.22"
```

## Recommended layout

```
crates/
├── browseros-cdp/        # transport: CdpClient (ws, pending map, event broadcast, keepalive),
│                         #   discovery /json/version, typed protocol structs via build.rs codegen
│                         #   from vendored protocol JSON (incl. BrowserOS custom domains)
├── browseros-core/       # browser layer: Session/PageManager/Observer/Input over browseros-cdp
├── browseros-mcp/        # rmcp #[tool_router] service over browseros-core; transport-agnostic
└── (apps/claw-server-rust)  # bin: axum + nest_service /mcp + REST/health; anyhow in main;
                          #   tracing-subscriber; optional --stdio flag
```

Split cdp/core so the 417KB-actions.rs failure mode of agent-browser is structurally impossible.
