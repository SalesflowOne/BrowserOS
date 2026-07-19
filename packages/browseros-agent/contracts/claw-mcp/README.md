# claw-mcp — cross-server real-browser MCP contract suite

Tier-3 integration for the BrowserClaw stack: deterministic local fixture
pages + a **spawned real BrowserOS** + the full MCP tool matrix, driven
against **both** claw servers (`apps/claw-server` TS and
`apps/claw-server-rust`) over their `/mcp` endpoints and compared
**semantically**. It exists because no lower tier could see the
`backendDOMNodeId` serde break that silently zeroed Rust ref-minting: unit
tests build structs directly, the mock-CDP tests speak the author's
casing, and the REST contract suite (`contracts/claw-api/`) sits above
this layer. This one puts a live browser in the loop.

## What it covers

~100 cases, one per behavior, across every MCP tool and failure path:
`tabs`, `tab_groups`, `windows`, `navigate`, `snapshot`, `diff`, `act`
(all kinds), `grep`, `read`, `evaluate`, `run`, `screenshot`, `pdf`,
`wait`, `upload`/`download`, `name_session`, plus the claw-layer
cross-cutting invariants (ownership isolation across two sessions, the
trust-boundary nonce fence, auto-context embedding, the REST audit
tie-in, cancellation, browser-down guidance, and transport hygiene).

Comparison is semantic, not byte-wise: same `(role, name)` interactive
sets carrying `[ref=`, same success/error classes, same spill/truncation
behavior, same guard texts. Expected cross-server differences are
registered in [`DIVERGENCES.md`](./DIVERGENCES.md) / `tests/divergences.ts`;
the suite fails only on a **new** divergence.

## Running it

The suite is **gated on `BROWSEROS_BINARY`**. Unset, it skips cleanly and
`bun run test` / `bun run check` stay green anywhere. Point it at a real
BrowserOS/BrowserClaw executable to run for real:

```bash
# From packages/browseros-agent/

# Full matrix against both servers (nightly tier):
BROWSEROS_BINARY=/Applications/BrowserClaw.app/Contents/MacOS/BrowserClaw \
  bun run test:claw-mcp-contract

# ~12-case smoke tier (<60s):
BROWSEROS_BINARY=/Applications/BrowserClaw.app/Contents/MacOS/BrowserClaw \
  bun run test:claw-mcp-smoke
```

`run.ts` pre-builds the Rust server (`cargo build -p claw-server-rust`)
outside the test timeouts, then execs the cross-server suite. For each
server it boots a **fresh headless BrowserOS profile**, attaches the
server to that browser's CDP port via a temp sidecar config, runs every
case in order through a raw streamable-HTTP MCP session, and finally runs
the parity gate. The two servers run sequentially — never two servers on
one browser.

### Useful env knobs

| var | effect |
|-----|--------|
| `BROWSEROS_BINARY` | **required** to run; path to the browser executable |
| `CLAW_MCP_SMOKE=1` | run only the smoke-tier cases (set for you by `--smoke`) |
| `BROWSEROS_TEST_HEADLESS=false` | run headed for debugging |
| `BROWSEROS_TEST_EXTRA_ARGS` | extra browser flags (e.g. `--no-sandbox` in CI) |
| `BROWSEROS_TEST_DEBUG=true` | stream the browser's stdout/stderr |
| `CLAW_MCP_CAPTURE_DIR=<dir>` | also dump raw CDP payloads (see below) |

The ungated unit tests (`fixture-server.test.ts`, `mcp-client.test.ts`)
run with plain `bun test` and need no browser; they are part of the root
`bun run test` suite along with a gated smoke step.

## Layout

```
contracts/claw-mcp/
  fixtures/
    pages/*.html         12 self-contained fixture pages, zero external resources
    server.ts            two-port static server (ports 10101-20202; second port = cross-origin OOPIF)
  tests/
    browser.ts           gated real-BrowserOS runtime (lifted from apps/server/tests helpers)
    mcp-client.ts        raw streamable-HTTP JSON-RPC/SSE client (no Origin header)
    server-adapters.ts   boots each real server entrypoint attached to the test browser
    cases-*.ts           the case matrix, one file per tool group
    cases.ts             ordered registry (browser-kill case stays LAST)
    parity.ts            semantic-signature ledger + cross-server gate
    divergences.ts       machine-checked twin of DIVERGENCES.md
    capture.ts           CLAW_MCP_CAPTURE_DIR mode
    cross-server.test.ts the bun:test entry
    run.ts               CLI entry: pre-build rust, gate, exec
```

## Adding a case

1. Pick the right `cases-<group>.ts` (or add one and register it in
   `cases.ts`). A case is `{ name, smoke?, run(ctx) }`.
2. Use `ctx` to drive the active server: `ctx.mcp` (session A),
   `ctx.openSession()` (session B), `ctx.openPage(url)`,
   `ctx.fixture(path)` / `ctx.fixture2(path)`, `ctx.browser`.
3. Record a semantic signature with `ctx.record(key, value)`. The parity
   gate compares each key across both servers. If the servers legitimately
   differ, tag it: `ctx.record(key, value, { divergence: 'some-id' })` and
   add `some-id` to `divergences.ts` + `DIVERGENCES.md`.
4. Clean up anything that would poison the next case (close pages, clear
   dialogs). Pages opened via `ctx.openPage` are closed for you. Never add
   a bare `sleep` — use `waitUntil(condition, …)`.
5. Case **order is load-bearing**: the browser-kill case must stay last.

## Registering a divergence

The parity gate fails on any recorded signature that differs across
servers unless the recording is tagged with a divergence `id` that exists
in `tests/divergences.ts`. To accept a new difference: add it to
`divergences.ts`, mirror it in `DIVERGENCES.md`, and tag the `ctx.record`
call. To stop accepting one (a server was fixed): drop the tag so equality
is enforced again.

## Capture mode → refreshing the browseros-core serde fixtures

`CLAW_MCP_CAPTURE_DIR` dumps the raw CDP payloads the snapshot pipeline
consumes — `Accessibility.getFullAXTree` (the `{"nodes":[…]}` shape of
`crates/browseros-core/tests/data/get-full-ax-tree.json`),
`Page.getFrameTree`, and a `DOM.describeNode` sample — one directory per
fixture page. Point it at the committed captured dir to refresh them:

```bash
CLAW_MCP_CAPTURE_DIR="$PWD/crates/browseros-core/tests/data/captured" \
  BROWSEROS_BINARY=/Applications/BrowserClaw.app/Contents/MacOS/BrowserClaw \
  bun contracts/claw-mcp/tests/run.ts --smoke

cargo test -p browseros-core --test captured_cdp_fixture
```

`captured_cdp_fixture.rs` asserts **structural** invariants only
(deserializes into `Vec<AxNode>`, backend node ids are present, interactive
pages mint refs) so a refresh never breaks the test. The hand-authored
`get-full-ax-tree.json` fixture and its exact-render test are left
untouched.

## CI

Per-PR CI does **not** run this suite (it needs a browser binary and is
slow). The full matrix runs in the nightly BrowserClaw workflow
(`.github/workflows/nightly-browserclaw.yml`) after the signed build,
pointed at the just-built binary.
