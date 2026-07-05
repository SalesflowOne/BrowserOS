# claw-server Inventory & Critique (spec for Rust rewrite)

Root: `packages/browseros-agent/apps/claw-server/` — ~8,700 lines TS, Bun-only, Hono, AGPL-3.0.

## What it is

Local backend ("cockpit") of BrowserClaw. Spawned BY the BrowserOS Chromium shell as a sidecar (launcher: packages/browseros/chromium_patches/chrome/browser/browseros/server/browseros_server_config.cc) with `--config <sidecar.json>` carrying ports {server: 9200, cdp: 49337, proxy?}. Spawns NOTHING itself. Dials back into Chromium over CDP (CdpBackend from browser-core). External agent harnesses (Claude Code, Codex, Cursor, VS Code, Zed, Gemini CLI, Claude Desktop) connect to single MCP endpoint http://127.0.0.1:9200/mcp (Streamable HTTP). Claw-server writes/removes MCP entries in harness config files (~/.claude.json etc.) via `agent-mcp-manager` npm lib (config-file surgery only). claw-app (extension UI) polls typed JSON API (hono-rpc AppType).

Flow per session: harness → MCP tools/call → guards → executeTool (browser-mcp) → CDP → tab; side channels: audit SQLite rows, JPEG screenshots, tab-activity registry, tab-group orchestration, rrweb replay files.

## Structure

```
src/
├── main.ts              entrypoint; startup/shutdown orchestration
├── server.ts            Hono app composition; exports AppType
├── config.ts            commander --config parsing → ClawConfig
├── env.ts               MUTABLE process-wide runtime snapshot (anti-pattern)
├── version.ts           __BROWSEROS_VERSION__ build define
├── local-server-url.ts  write-once global
├── routes/
│   ├── system.ts        /system/{health,shutdown,version,url}
│   ├── agents/*         profile CRUD (file-backed)
│   ├── agents-control/  POST /agents/:agentId/cancel
│   ├── site-rules/*     site rules CRUD
│   ├── permissions/     GET /permissions/catalog
│   ├── connections/     harness connect/disconnect/list
│   ├── mcp-v2/          ALL /mcp → single-server handler
│   ├── tabs/            GET /tabs/activity (polled ~1.5s)
│   ├── tabs-focus/      POST /tabs/focus/:agentId
│   ├── audit/*          dispatches/tasks/screenshots
│   └── audit-replay/*   rrweb replay endpoints
├── mcp/
│   ├── register.ts (782 ln)   tool registration + ENTIRE dispatch pipeline (400-line closure)
│   ├── single-server.ts (335) session map, sweeper, request router
│   ├── register-fn.ts         zod v3/v4 cast shim
│   ├── cancellation-result.ts
│   └── session-naming.ts      MCP elicitation → session label
├── lib/  browser-bootstrap, browser-session (singleton), browseros-dir, storage (atomic JSON),
│         logger (hand-rolled), mcp-manager, mcp-session/identity, tab-activity, agent-tabs,
│         agent-tab-groups, approval-catalog, async-mutex, errors, match-domain, slug,
│         migrate-mcp-urls
├── services/ tasks (411 ln, read-time deriver), audit-log, session-events, screenshots,
│             screencast-{cache,poller}, replay-{storage,tabs}, tab-group-ops (344),
│             dispatch-cancellation, harness-install, browseros-connect, mcp-relink,
│             spec-for (http vs stdio npx mcp-remote), claude-code-heal, permissions (DEAD in v2),
│             tool-result-image
├── modules/db/  drizzle + bun:sqlite; 3 tables: tool_dispatches, agent_session_starts, agent_session_ends
└── shared/{port,mcp-url,mcp-url-common}  consumed by claw-app UI too
```

## Endpoints (loopback, NO auth, wildcard CORS)

- ALL /mcp — v2 single Streamable-HTTP endpoint. Initialize w/o mcp-session-id header mints (McpServer, WebStandardStreamableHTTPServerTransport) keyed by SDK UUID; route by header; unknown → 404 {error:'unknown mcp-session-id', hint}. DELETE closes. All 16 BROWSER_TOOLS exposed.
- GET /system/health → {status:'ok'}; POST /system/shutdown; GET /system/version; GET /system/url
- POST /agents (NewAgentValues {name, harness, loginMode(profile|all|selective), selectedSites[], approvals{verb→Auto|Ask|Block}, aclRuleIds[], customAclRules[]}) → 201 CreatedAgent {id,name,harness,slug,mcpUrl,cliCommand,harnessInstall}; GET /agents → summaries (lastRunAt HARDCODED 'Never run', alwaysAllowCount: 0); GET/PATCH/DELETE /agents/:id; POST /agents/:id/mcp-url:regenerate
- POST /agents/:agentId/cancel → aborts in-flight dispatches (agentId = SESSION-scoped v2 id, not profile id!)
- GET/POST /site-rules, DELETE /site-rules/:id — {id,label,domain,action(payments|submit|delete|navigate|upload|admin)}
- GET /permissions/catalog — static 6 verbs
- GET /tabs/activity → EnrichedTabRecord[] joined w/ profiles+identities+screencast frame
- POST /tabs/focus/:agentId → expand group + activate window
- GET /connections; POST /connections/:harness/connect|disconnect
- GET /audit/dispatches?agentId&sessionId&cursor&limit(≤500) — id DESC keyset
- GET /audit/tasks?agentId&status(live|done|failed)&site&search&since&cursor&limit(≤100) — "task" = MCP session, derived AT READ TIME
- GET /audit/tasks/:sessionId; GET /audit/screenshot/:dispatchId (jpeg, immutable cache)
- POST /audit/replay/:sessionId/events (NDJSON; server rewrites sessionId per line; 410 when identity gone); GET /audit/replay/:sessionId (NDJSON stream); GET /audit/replay/:sessionId/exists; GET /replay/tabs

## Integration

- BROWSER_TOOLS from browser-mcp/registry; executeTool from tools/framework (called from: dispatch handler, tab-group-ops, nothing else). Does NOT use createBrowserMcpServer.
- browser-core: new CdpBackend({port: env.cdpPort, exitOnReconnectFailure: false}) → connect() → new Browser(cdp).session. Soft-fails to null at boot; NO REATTACH LOOP (restart required if BrowserOS was down at boot).
- session.screenshot(pageId, {format:'jpeg', quality:50, annotate:false}) used directly by screencast poller (bypasses tool clip logic to avoid viewport reflow, commit f3f57ac29).

## State

Persistent under <browserosDir>/claw-server/: agents/<id>.json, site-rules.json, audit.sqlite (+WAL, drizzle), screenshots/<dispatchId>.jpg, replays/<sessionId>.ndjson (LRU 50 handles, 30s idle close, per-session append chains), claw-server.log(+.old), mcp-manager/ manifest. Writes OUTSIDE root: harness MCP config files (~/.claude.json + type:http boot heal, claude_desktop_config.json, ~/.cursor/mcp.json, VS Code/Zed/Codex/Gemini).

9 in-memory module singletons: sessions map + idle sweeper (idle 5min, sweep 60s; env CLAW_SESSION_IDLE_MS/CLAW_SESSION_SWEEP_INTERVAL_MS), identityService, tabActivityRegistry (targetId-keyed, active = <30s), agentTabs (agentId → owned pageIds + first-capture), tabGroupTracker (agentId → group record, refCount), screencastCache (pageId → JPEG, LRU 50, 3-failure backoff), dispatchCancellation (sessionId → Set<AbortController>), browser-session, local-server-url + mutable env.

Identity v2: agentId = slugify(clientInfo.name) + '-' + fnv1a(sessionId)[:6]. cleanupSessionState manually unwinds everything (past leaks admitted in comments).

## Startup/shutdown

Startup: parse config → applyClawConfig(env) → createServer → Bun.serve 127.0.0.1 (EADDRINUSE = singleton lock) → file log sink → set URL → claude-code type:http heal → CDP bootstrap (soft-fail) → setBrowserSession, screencast poller, SIGINT/SIGTERM handlers → fire-and-forget migrateMcpUrls. Shutdown: guard flag, stop poller, 5s SIGKILL backstop (unref), disconnect → exit(0). No MCP session drain, no session-end rows for live sessions, no signal handlers when bootstrap absent.

## Deps

hono + @hono/zod-validator; @modelcontextprotocol/sdk ^1.27; agent-mcp-manager ^0.0.3; zod v4 (vs v3 in browser-mcp → cast shims); drizzle-orm/kit + bun:sqlite; commander; nanoid.

## DESIGN CRITIQUE → Rust rewrite requirements

a) **Dispatch pipeline is a 400-line closure** (mcp/register.ts): scheme guard → session guard → script audit warn → page-ownership guard → cancellation reg → execute → cancel remap → failure log → audit → activity write → audit-DB write → screenshot persist (tabs-new special case) → tab-group orchestration → tabs-close ledger drain → tabs-list result rewriting → missing-identity warn. Tool-specific behavior via `if (tool.name === ...)`. → Rust: explicit interceptor chain (Guard → Execute → Observers), per-tool post-hooks declared on the tool, each stage unit-testable.

b) **Dead permission system**: registerBrowserTools legacy path (only caller of permissions.check) has ZERO production callers. Approvals/site-rules/permissions-catalog UI-visible but enforce NOTHING on live /mcp path. → decide: bind permissions into v2 pipeline via unified identity, or drop the surface. Don't port the ghost.

c) **Two disjoint identity systems** (stored profiles vs session-scoped). Nothing links them; lastRunAt hardcoded; cancelByAgent only works with session ids. → one AgentRef resolved at initialize (clientInfo → stored profile, else ephemeral), carried through every dispatch, joining profiles↔sessions↔audit.

d) **Singleton sprawl + manual cleanup**. Test escape hatches baked into prod code. Tab state = 4 maps with 3 key schemes (targetId/agentId/pageId). → single Session aggregate owning identity/tabs/cancellation/group/replay, one SessionRegistry, Drop-based teardown; one Tab entity.

e) **Mutable global env + import-time side effects** → immutable Arc<Config>, no statics.

f) **Thin traceability**: no request ids, no span/trace correlation HTTP↔MCP session↔dispatch↔audit row↔CDP call; failure-only request logging; single-file rotation w/ multi-instance clobber bug. → tracing spans per dispatch {session_id, dispatch_id, agent, tool}; dispatch_id in audit row; tracing-appender rotation; optional OTLP.

g) **Read-time task derivation broken**: paginate by session at SQL then filter in JS → phantom-empty pages; N existsSync per list; IDLE_TIMEOUT must "match" env by comment. → materialized tasks table updated by session lifecycle; screenshot-presence as DB column; one shared idle constant.

h) **Copy-paste duplication**: scheme guard, agentLabel (3×), FNV-1a (2×), 3 slugifiers, ID patterns, untyped structuredContent grovelling. → shared typed result model + util crate.

i) **No auth, wildcard CORS, unauthenticated /system/shutdown** → random bearer token minted at launch, passed via sidecar handshake + written into harness MCP configs; token middleware; extension-origin allowlist.

j) **Robustness**: no CDP reattach loop; no graceful session drain; unbounded screenshots/replays/audit growth (no retention); screencast timeout races uncancellable screenshot (no AbortSignal in CDP layer — Rust: real cancellation); hand-rolled AsyncMutex/promise chains → tokio primitives/actors.

k) **Comment/code drift**; invariants live in prose → encode in types: newtypes SessionId/PageId/TargetId/AgentId/DispatchId.

l) Per-session server construction registers all 16 tools each time → one shared tool table + per-session context.

Churn areas (design pressure): harness config-file management (most fragile — give it a state machine with dry-run/verify), session identity + elicitation naming, screencast/viewport, idle reaping, canonical URL/port, logging retrofits.
