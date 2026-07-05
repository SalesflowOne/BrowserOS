# claw-server-rust — the redesigned cockpit

Rust rewrite of `apps/claw-server`, keeping its **wire contracts** (HTTP shapes the
claw-app UI polls, the `/mcp` endpoint, the `--config` sidecar JSON, the on-disk layout
under `~/.browseros/claw-server/`) while fixing the design debts catalogued in
[reference/claw-server-inventory.md](./reference/claw-server-inventory.md) §9.

## What stays the same (contracts)

- Spawned by the BrowserOS shell with `--config <sidecar.json>` (`ports.server`,
  `ports.cdp`, `ports.proxy?`); binds 127.0.0.1; EADDRINUSE = singleton lock.
- Single MCP endpoint `ALL /mcp` (streamable HTTP, stateful sessions, `mcp-session-id`
  header routing, DELETE closes, unknown id → 404 with hint).
- All existing REST endpoints and JSON shapes (system, agents CRUD, agents cancel,
  site-rules, permissions catalog, tabs activity/focus, connections, audit
  dispatches/tasks/screenshots, replay). claw-app must not need changes to point at it.
- Storage layout: `agents/*.json`, `site-rules.json`, `audit.sqlite`, `screenshots/`,
  `replays/*.ndjson`, log file, `mcp-manager/` manifest — same directory, same formats
  (SQLite schema starts from the same 3 tables; see Migrations below).
- Harness config-file management (writing MCP entries into `~/.claude.json`, Cursor,
  Zed, …) — reimplemented natively (the TS used the `agent-mcp-manager` npm lib).

## Architecture

```
apps/claw-server-rust/src/
├── main.rs                  # anyhow; clap --config; tracing init; supervised startup
├── config.rs                # sidecar parse → immutable Arc<Config> (no mutable env!)
├── app.rs                   # axum Router assembly
├── domain/
│   ├── ids.rs               # SessionId, DispatchId, AgentId, ProfileId newtypes (+ PageId/TargetId from core)
│   ├── agent_ref.rs         # ONE identity: resolved at MCP initialize → stored profile | ephemeral
│   ├── session.rs           # Session aggregate: identity, owned pages, cancel tokens,
│   │                        #   tab-group ref, replay handle, activity — ONE struct
│   └── registry.rs          # SessionRegistry: mint/lookup/sweep; teardown = drop the aggregate
├── dispatch/
│   ├── pipeline.rs          # interceptor chain: Vec<Arc<dyn Guard>>, Vec<Arc<dyn Observer>>
│   ├── guards.rs            # NavigateSchemeGuard, PageOwnershipGuard, BrowserConnectedGuard,
│   │                        #   (optional) PermissionGuard
│   └── observers.rs         # AuditWriter, ScreenshotPersister, TabActivityTracker,
│                            #   TabGroupOrchestrator, TabsResultFilter (per-tool hooks
│                            #   declared per tool, not if-chains in a mega-closure)
├── mcp/
│   ├── endpoint.rs          # rmcp streamable-http service factory per session
│   └── handler.rs           # per-session ServerHandler: catalog from browseros-mcp,
│                            #   every call_tool goes through dispatch::pipeline
├── routes/                  # axum handlers mirroring the TS routes 1:1
├── services/
│   ├── browser.rs           # CDP bootstrap + RE-ATTACH LOOP (backoff; fixes boot-order gap)
│   ├── audit.rs             # rusqlite (bundled) + migrations; tasks MATERIALIZED table
│   ├── screenshots.rs, screencast.rs, replay.rs, tab_activity.rs
│   └── harness/             # harness config management as a STATE MACHINE
│       ├── manifest.rs      #   link ledger (mcp-manager/ manifest, same format)
│       ├── surfaces.rs      #   per-harness config file adapters (claude-code, cursor, …)
│       └── plan.rs          #   plan → verify → apply → rollback (no best-effort try/catch chains)
└── storage.rs               # atomic JSON store (tmp+rename), zod parity via serde
```

### The dispatch pipeline (fixes critique a, b, l)

One shared tool catalog; per-session `DispatchCtx { session: Arc<Session>, dispatch_id,
tool, args, cancel }`. Execution:

```
guards (fail → isError result)  →  execute (browseros-mcp)  →  observers (infallible, logged)
```

- Guards and observers are small structs implementing `Guard`/`Observer` traits —
  individually unit-testable, registered declaratively.
- Tool-specific behavior (tabs-list filtering, tabs-new screenshot special case,
  tab-group auto-grouping) attaches as per-tool hooks in the tool descriptor, not
  string-matched in the pipeline.
- Permission enforcement decision: the pipeline includes a `PermissionGuard` slot wired
  to the stored profile resolved via `AgentRef` — the TS v2 path silently enforced
  nothing; here the guard runs whenever a dispatch's `AgentRef` carries a profile, and
  the approvals surface finally does something. Verbs map per tool exactly as
  `TOOL_TO_VERB` did.

### Identity (fixes critique c)

`AgentRef` resolved once at MCP initialize: match `clientInfo` against stored profiles →
`AgentRef::Profile(ProfileId, session-scoped AgentId)`, else
`AgentRef::Ephemeral(AgentId)`. Same `slugify(clientName)-fnv1a(sessionId)[:6]` display id
for continuity. Carried in every dispatch span and audit row → profiles, sessions, audit,
cancel all join; `lastRunAt` becomes real.

### Session lifecycle (fixes critique d)

`Session` owns everything; `SessionRegistry::remove` drops it, and `Drop`/an explicit
async `teardown()` releases group refs, cancels in-flight dispatches, writes the
session-end row, closes the replay handle. Idle sweeper and graceful shutdown call the
same teardown (shutdown drains sessions — the TS server didn't).

### Traceability (fixes critique f) — a headline goal

- `tracing` with a span per HTTP request (`request_id`) and per dispatch
  (`session_id`, `dispatch_id`, `agent`, `tool`); CDP sends log at `debug` within the
  dispatch span → one grep joins HTTP ↔ MCP ↔ CDP ↔ DB.
- `dispatch_id` (ULID) persisted in the audit row.
- `tracing-subscriber` EnvFilter (`CLAW_LOG`), stderr + `tracing-appender` daily rotation.
- `/system/health` gains subsystem detail (CDP connected, epoch, session count) — shape
  is additive, existing `{status:'ok'}` field preserved.

### Audit & tasks (fixes critique g)

Same `tool_dispatches` / `agent_session_starts` / `agent_session_ends` tables (migrations
replayed from the drizzle SQL), plus a **`tasks` table materialized** by session
lifecycle + dispatch observers (status live/done/failed, site, counts,
`has_screenshots`). `/audit/tasks` becomes a pure SQL query — filters and keyset
pagination compose correctly.

### Robustness (fixes critique i, j)

- CDP **re-attach loop** with exponential backoff (1s→30s cap) whether or not BrowserOS
  was up at boot; `/mcp` returns a clear "browser not connected (retrying)" tool error
  meanwhile.
- Real cancellation end-to-end: operator cancel → `Session` child tokens → CDP sends.
- Retention: startup + daily sweep applying config-driven caps to screenshots/, replays/,
  audit rows (default: keep 14 days / 2 GiB, configurable in sidecar JSON; off = TS
  parity if unset).
- Optional bearer auth: if the sidecar config carries `auth.token`, all routes except
  `/system/health` require it, and the minted MCP URLs embed it. Absent → TS-parity open
  loopback (default for drop-in swap).

## Migrations / coexistence

- Reuses the same `audit.sqlite`; runs the existing 2 SQL migrations if the DB is fresh,
  then its own (tasks table, has_screenshots column) — additive only, so switching back
  to the TS server keeps working.
- Binary name `browseros-claw-server-rs`; the shell launcher can point at either binary.
  Never run both against the same port/dir.

## Dependencies

axum 0.8, rmcp 2.1 (streamable-http-server), tokio, tower, rusqlite (bundled),
serde/serde_json, schemars, thiserror/anyhow, tracing + tracing-subscriber +
tracing-appender, tokio-util (CancellationToken), ulid, clap (derive, replaces
commander), notify-free (no watchers in v1). Internal: browseros-cdp, browseros-core,
browseros-mcp.
