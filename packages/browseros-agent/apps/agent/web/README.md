# Web Harness — run the agent UI as a plain web page

Runs the **exact** agent UI (`entrypoints/app`) as an ordinary web page on
`http://localhost:5300`, connected to the **real** local `apps/server`. No
extension load, no mocked agent — so it's a true integration target you can drive
with an e2e tool.

## How it works

| Layer | Real or faked | Notes |
|-------|---------------|-------|
| React UI, transport (HTTP/SSE), agent loop, model, tools, operated browser | **Real** | Same code + server as production |
| `chrome.storage` / `tabs` / `runtime` | Faked (in-memory, `@webext-core/fake-browser`) | Just so the app boots in a tab |
| `chrome.browserOS` | Stub — **except** the MCP server port, which is real | Port comes from `VITE_BROWSEROS_MCP_PORT`; the rest are no-ops |

The app derives its server URL from `chrome.browserOS.getPref('browseros.server.mcp_port')`
(`lib/browseros/helpers.ts`). The shim returns the real port there, so the page hits
the real server with **zero changes to app code**. No server change is needed: the
server already trusts any `http://localhost:*` origin (`isTrustedAppOrigin`).

Files:
- `vite.config.ts` — standalone Vite server (port 5300) for `entrypoints/app`.
- `shim.ts` — installs `fakeBrowser` as `globalThis.chrome`/`browser` + BrowserOS/sidePanel stubs.
- `browseros-stub.ts` — localStorage-backed pref store (real port; provider config persists) + no-op browser-control methods.
- `main.tsx` / `index.html` — thin web entry that loads the shim, then the real app bootstrap.
- `e2e/chat.e2e.sh` — example `agent-browser` driver.

## Run it

```bash
# 1. Start the real stack (BrowserOS + server). Note the MCP port it prints.
bun run dev:watch

# 2. Serve the web harness (from apps/agent). Pass the real port if not 9100.
cd apps/agent
VITE_BROWSEROS_MCP_PORT=<port> bun run web
# → open http://localhost:5300
```

`import.meta.env.DEV` is `true` under `vite`, so all capability features are enabled
and the UI renders without a login. For a chat to actually reply, configure an LLM
provider/agent (same as normal dev) — you can do this in the web UI; provider prefs
persist in `localStorage`.

## Drive it (e2e)

```bash
# with the harness open and agent-browser installed:
INPUT_REF=@e12 SEND_REF=@e15 bash web/e2e/chat.e2e.sh "go to example.com and tell me the title"
```

`agent-browser` is a real-browser CLI over CDP (it has a `-p browseros` provider). It
opens the page, types, clicks, and reads rendered output — the e2e *driver*. (It is not
the in-page `chrome.*` shim; that's `fakeBrowser` + the BrowserOS stub.)

## Scope / limits (v1)

- Browser-control `browserOS` calls (snapshot/click/screenshot) are no-ops on the page —
  fine, because the agent's tools run server-side over the server's own CDP connection.
- Content scripts, the background worker, scheduling, and the side panel are not part of
  the web page; the core chat path doesn't need them.
