# BrowserClaw → BrowserOS port ("company" domain)

Ports the **BrowserClaw** desktop app (`agent-company/apps/desktop`, an Electron
"agents-as-employees" product) into this monorepo:

- **Backend** → `apps/server/src/company/` (mounted into the existing Hono server at `/company`)
- **UI** → `apps/agent/entrypoints/company/` (a self-contained WXT page entrypoint → `company.html`)

Both packages typecheck clean and the extension builds (`company.html` is emitted).

## What it is

Hire "employees" (role + personality + workspace, backed by a claude/codex ACP
agent), chat 1:1 in **threads**, collaborate in multi-agent **channels**, with an
org chart, announcements feed, skills, Telegram bridges, permission/approval
gating, and a "watch it browse" screencast pane. The renderer talks to the
backend purely over HTTP+SSE (no Electron IPC), which is why it ported cleanly.

## Layout

```
apps/server/src/company/
  main/            ← ported from desktop/src/main (Hono routes, chat/ACP engine,
                     channels, browseros client, skills, telegram, settings, …)
    bootstrap.ts   ← NEW: server-runtime replacement for the Electron main() boot
    server.ts      ← the company Hono router (default export) + AppType
  db/              ← ported from desktop/src/db (Drizzle schema, libSQL client)
  shared/          ← ported from desktop/src/shared (cross-process types)
  drizzle/         ← ported migrations (libSQL)
  resources/built-in-skills/  ← ported skill bundles

apps/agent/entrypoints/company/
  index.html       ← WXT entrypoint → company.html
  boot.tsx         ← resolves the agent-server URL, stashes it, then loads the app
  mainview/        ← ported from desktop/src/mainview (routes, screens, components, …)
  shared/          ← ported from desktop/src/shared (sibling of mainview, preserves
                     the renderer's relative `../shared` imports)
```

## Wiring

- **Server mount**: `apps/server/src/api/server.ts` mounts `companyRoutes` at `/company`
  (no trusted-origin gate — spawned ACP agents POST to the in-process MCP endpoints
  with no Origin header, like `/chat` and `/mcp`). `AppType` (rpc.ts) carries it.
- **Server boot**: `Application.start()` calls `bootstrapCompany({ serverPort })` after
  the HTTP server is listening (non-fatal on error). It inits the company libSQL DB,
  primes acpx, recovers interrupted turns, sets the in-process MCP base URL to
  `http://127.0.0.1:<port>/company`, and starts skills/workspaces/telegram.
- **UI type bridge**: the renderer's `shared/api.ts` imports `AppType` from the new
  `@browseros/server/company` package export.
- **UI base URL**: `boot.tsx` calls the extension's `getAgentServerUrl()`, stores
  `${url}/company` under the renderer's existing sessionStorage key, then dynamically
  imports the app so the api client's module-load snapshot picks it up.
- **Alias**: the renderer's shadcn-style `@/` was rewritten to `@company/` (tsconfig
  path + Vite `resolve.alias` → `entrypoints/company/mainview`) so it doesn't collide
  with the extension's own `@` → project-root alias.

## Electron seams removed/neutralized (server)

- `notifications/native.ts` + `dispatcher.ts` — deleted (dead, Electron-only).
- `telegram/secrets.ts` — `electron.safeStorage` → AES-256-GCM keyed from
  `COMPANY_SECRET_KEY` env or a generated `~/.browserclaw/secret.key`.
- `routes/system.ts` `pick-directory` — native dialog → returns `{path:null}`
  (enter workspace paths manually).
- `settings/autostart.ts` — `app.setLoginItemSettings` → no-op (pref still persists).
- `browseros/electron-focus.ts` — focus-steal → no-op.
- `skills/built-ins.ts` — `app.isPackaged`/`process.resourcesPath` →
  `src/company/resources/built-in-skills` (override via `COMPANY_BUILT_IN_SKILLS_DIR`).

## Dependencies

- server +`nanoid`, `@libsql/client`, `acpx-ai-provider`, `agent-skills-manager`,
  `@chat-adapter/telegram`, `chat`; bumped `@modelcontextprotocol/sdk` 1.27→1.29.
- agent +`@base-ui/react`(pinned `1.4.1`), `@fontsource-variable/geist`,
  `@tanstack/react-router`, `@tabler/icons-react`, `react-query-kit`, `@streamdown/*`.

## ⚠️ Known follow-ups (NOT yet done)

1. **acpx runtime version conflict (highest risk).** The server's own harness uses
   `acpx@0.6.1`; the ported chat engine uses `acpx-ai-provider@0.0.6` (peer wants a
   newer acpx). Permission *types* were repointed to `acpx-ai-provider`'s re-exports
   so it typechecks, but a real chat turn's runtime behavior against acpx 0.6.1 is
   **unverified**. Reconcile acpx versions (likely bump to ~0.10 and validate the
   existing harness) before relying on company chat turns.
2. **BrowserOS integration.** The company still drives BrowserOS as an *external* app
   over HTTP-MCP (default `http://127.0.0.1:9200/mcp`), exactly as BrowserClaw did.
   Auto-spawn is gated behind `COMPANY_ENABLE_BROWSEROS_SPAWN=1` (default off). Cleaner:
   point `browserosMcpUrl` at this server's own `/mcp`, or use the in-process CDP browser.
3. **streamdown plugins.** The extension is on streamdown 1.x; the company markdown was
   written for 2.x. The explicit `@streamdown/*` (cjk/code/math/mermaid) plugins were
   removed from `MarkdownView`/`ChatMessageRow` (built-in rendering still works).
   Re-enable when the extension moves to streamdown 2.x.
4. **Removed dead AI Elements** (unused, base-ui 1.5 API drift): `confirmation`,
   `context`, `inline-citation`, `prompt-input`, `plan`. Re-add via the AI Elements
   CLI once base-ui is aligned.
5. **Two databases.** Company uses its own libSQL DB at `~/.browserclaw/data.db`,
   separate from the server's bun:sqlite `~/.browseros/db/browseros.db`. Could unify.
6. **Placement.** `chrome_url_overrides.newtab` → `company.html`, so the agent-company
   UI **is** the new tab. The old BrowserOS Home (`app.html`) still backs `options_ui`
   (`app.html#/settings`) and remains reachable directly. Reload the unpacked extension
   (or `wxt dev` hot-reloads) and open a new tab to see it.
7. **One TS2589 suppression** per MCP `registerTool` site (`@ts-ignore`) — the SDK's
   generic instantiates too deep under tsgo. Runtime unaffected.
