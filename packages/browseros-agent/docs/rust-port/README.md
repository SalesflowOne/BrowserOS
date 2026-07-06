# BrowserOS Rust port — architecture

Status: design approved, build in progress (July 2026).

We are porting the browser-automation stack to Rust as **new, parallel packages** — the
TypeScript packages stay untouched and remain the production path until the Rust stack
reaches parity:

| TypeScript (existing, kept) | Rust (new) |
|---|---|
| `packages/cdp-protocol` + `packages/browser-core` | `crates/browseros-cdp` + `crates/browseros-core` |
| `packages/browser-mcp` | `crates/browseros-mcp` |
| `apps/claw-server` | `apps/claw-server-rust` |

Detailed designs:

- [01 — browseros-cdp](./01-browseros-cdp.md) — CDP transport + typed protocol codegen
- [02 — browseros-core](./02-browseros-core.md) — session/page/observer/input layer
- [03 — browseros-mcp](./03-browseros-mcp.md) — the 16 MCP tools on rmcp
- [04 — claw-server-rust](./04-claw-server-rust.md) — the redesigned cockpit server

Reference inventories of the TS code (the porting contracts) live in
[`reference/`](./reference/): [browser-core](./reference/browser-core-inventory.md),
[browser-mcp](./reference/browser-mcp-inventory.md),
[claw-server](./reference/claw-server-inventory.md),
[ecosystem research](./reference/rust-ecosystem-notes.md).

## Why these dependency choices

- **Raw CDP client, no chromiumoxide/headless_chrome.** The TS `browser-core` is already a
  hand-rolled raw-WebSocket CDP client, and BrowserOS ships **custom CDP domains**
  (`Browser` tab/window/group surface, `Bookmarks`, `History`) that no third-party crate
  knows about. chromiumoxide is launch-centric and its handler event loop fights a
  long-lived reconnecting server; headless_chrome is sync. vercel-labs/agent-browser
  validates the raw approach in production (tokio-tungstenite + pending-map + broadcast
  events + build.rs codegen from vendored protocol JSON).
- **rmcp 2.1** (official MCP Rust SDK, spec 2025-11-25): `#[tool_router]`/`#[tool]` macros,
  schemars 1.0 schemas, stdio + streamable-HTTP-server transports; the HTTP transport is a
  tower service that nests directly into axum.
- **axum 0.8** for HTTP; **thiserror 2** per library crate, **anyhow** only in binaries;
  **tracing** everywhere with `tracing-subscriber` initialized once in the binary.

## Workspace layout

Cargo workspace rooted at `packages/browseros-agent/Cargo.toml` (virtual manifest):

```
packages/browseros-agent/
├── Cargo.toml                 # [workspace] members, workspace.{package,dependencies,lints}, profiles
├── crates/
│   ├── browseros-cdp/         # lib: transport + typed protocol (build.rs codegen)
│   ├── browseros-core/        # lib: Browser/Session/PageManager/Observer/Input/Screenshot
│   └── browseros-mcp/         # lib: rmcp tool service over browseros-core
└── apps/
    └── claw-server-rust/      # bin crate `claw-server-rust`, binary `browseros-claw-server-rs`
```

Conventions (copied from uv/turborepo, see ecosystem notes):

- Edition 2024, `rust-version` pinned in `[workspace.package]`; members inherit via
  `field.workspace = true`.
- Every external **and internal** dependency declared once in `[workspace.dependencies]`;
  members use `dep.workspace = true`.
- `[workspace.lints]`: `unsafe_code = "deny"`, `clippy::unwrap_used = "deny"` and
  `clippy::expect_used = "deny"` in library crates, `clippy::print_stdout/print_stderr/
  dbg_macro = "warn"` (forces `tracing`). Each member sets `[lints] workspace = true`.
- Profiles only in the root: `[profile.release] lto = "thin", codegen-units = 1, strip = true`.
- `apps/cli` (Go) is precedent: non-JS apps need no `package.json`; bun workspace globs
  ignore them.

## Build integration (bun entry points)

Added to `packages/browseros-agent/package.json`:

```jsonc
"build:claw-server-rust":  "cargo build --release -p claw-server-rust",
"build:rust":              "cargo build --workspace",
"test:rust":               "cargo test --workspace",
"lint:rust":               "cargo clippy --workspace --all-targets -- -D warnings",
"fmt:rust":                "cargo fmt --all --check"
```

The release binary lands at `target/release/browseros-claw-server-rs`. Packaging into the
prod resource pipeline (`scripts/build/` descriptor, R2 upload) is a follow-up once the
server reaches parity; the descriptor pattern in `scripts/build/claw-server/descriptor.ts`
is the template.

## Dev workflow

Use the Rust claw-server in the full BrowserClaw dev stack with:

```bash
bun run dev:claw-rust:watch
```

That command runs the normal BrowserClaw app, static web preview, Chromium/CDP profile,
and sidecar config flow, but swaps the standalone server leg to:

```bash
cargo run -p claw-server-rust -- --config <sidecar>
```

The Go dev supervisor polls Rust source/build inputs (`apps/claw-server-rust/src`,
`crates/*/src`, package manifests, build scripts, protocol JSON, embedded SQL migrations,
`Cargo.toml`, and `Cargo.lock`) and restarts the Cargo process on edits, so debug builds
recompile without requiring `cargo-watch`, `watchexec`, or `bacon`. Use
`bun run dev:claw-rust:watch:new` for a fresh profile and random dev ports.

Today this exercises the Phase C Rust server surface: system routes, agent/profile routes,
storage, harness config, audit/replay routes, and the same sidecar port contract as the TS
server. `/mcp` still returns the Phase D 503 stub on branches where Phase D has not landed.
Once Phase D merges, this same command exposes the Rust MCP endpoint at the sidecar server
port, typically `http://127.0.0.1:9200/mcp`.

## Delivery phases

1. **Phase A** — workspace scaffold + `browseros-cdp` + `browseros-core` (with ports of the
   existing unit tests: refs, render, diff, observer, resolve, keyboard).
2. **Phase B** (after A) — `browseros-mcp`: all 16 tools, behavior-compatible.
3. **Phase C** (after A, parallel with B) — `claw-server-rust` scaffold: config, tracing,
   domain model, storage, all non-MCP HTTP routes.
4. **Phase D** (after B+C) — dispatch pipeline integration, screencast poller, bun script
   wiring, end-to-end smoke against a running BrowserOS.

Each phase is dispatched as its own worktree/PR; `main` must build and pass
`cargo test/clippy` after every merge.

## Compatibility contracts (do not break)

- MCP tool **names, input schemas, structuredContent field names** match the TS tools —
  claw-app and downstream agents parse them (`tabs new` → `{page}`, etc.). The `act`
  schema stays **flat** (provider JSON-Schema compat).
- Page addressing: stable integer `page` ids minted per target, surviving cross-process
  navigations (tabId matching). Element refs `eN` with the same stability rules.
- All page-derived text wrapped in the `[UNTRUSTED_PAGE_CONTENT nonce=… origin=…]` fence.
- Large outputs spill to `~/.browseros/tool-output/` with the same thresholds and file
  naming (`<tool>-<epoch-ms>-<uuid>.<ext>`, 0600, never overwrite).
- claw-server-rust serves the same HTTP wire shapes as `apps/claw-server` (claw-app UI
  polls them) and reads the same `--config` sidecar JSON.
