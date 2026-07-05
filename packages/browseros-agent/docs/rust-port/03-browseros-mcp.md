# browseros-mcp — MCP tools crate

Rust port of `packages/browser-mcp` on **rmcp 2.1**.
Full behavioral contract: [reference/browser-mcp-inventory.md](./reference/browser-mcp-inventory.md).

## Shape

Transport-agnostic library crate (exactly like the TS package): it defines the tool
catalog + execution framework and a ready-made rmcp `ServerHandler`; consumers pick the
transport (claw-server-rust nests the streamable-HTTP tower service; a `--stdio` mode
falls out for free).

```
crates/browseros-mcp/src/
├── lib.rs
├── service.rs           # BrowserMcpService: rmcp ServerHandler (instructions, logging cap no-op)
├── framework.rs         # ToolDef trait/registry, execute_tool dispatch contract
├── response.rs          # ToolResponse builder + post-actions (snapshot/diff/screenshot/pages)
├── trust_boundary.rs    # wrap_untrusted() nonce fencing
├── output_file.rs       # ~/.browseros/tool-output spill files (0700/0600, wx, naming parity)
├── format/{snapshot,diff,token_estimate}.rs
└── tools/{tabs,tab_groups,navigate,snapshot,diff,act,download,upload,read,grep,
          screenshot,pdf,wait,windows,evaluate,run}.rs
```

## Dispatch contract (must match TS `executeTool`)

1. Deserialize/validate args (schemars-backed) → on failure, `isError` text
   `Invalid arguments for <name>: <path>: <message>; …` — an error **result**, not a
   protocol error.
2. Run handler with a `ToolCtx { session: BrowserSession, defaults, cancel: CancellationToken, output_files }`.
3. Handler panics/errors (non-cancel) → `isError` result `"<name> failed: <msg>"`.
4. Queued post-actions each raced against **2s** and silently swallowed on failure,
   appended after `\n--- Additional context (auto-included) ---`:
   navigate → fresh snapshot; act → diff (+ structured merge). Cancellation propagates
   (does not become isError).
5. `structuredContent` on every tool with the **same field names** as TS.

## Tool-by-tool notes

All 16 tools, same names/descriptions/schemas (see inventory §2 for the full schema
table). Highlights:

- **act**: keep the schema **flat** (kind + optional fields, runtime-validated per kind) —
  discriminated unions break some providers' JSON-Schema support.
- **tabs/tab_groups/windows**: thin over `PageManager`/`WindowManager`/custom `Browser.*`
  CDP domain, including the create-with-groupId+title error and update-requires-a-field
  validation quirks.
- **snapshot/diff/read/grep/evaluate**: spill-to-file thresholds and excerpting exactly as
  TS (15k-token snapshot / 10k diff / 5k chars others; chars÷3 token heuristic).
- **download**: fresh `mkdtemp` subdir under tool-output, `Page.setDownloadBehavior`,
  listen `downloadWillBegin`/`downloadProgress`, 60s timeout, restore default behavior.
- **wait**: timeout → `matched:false` result, **not** an error; `DEFAULT_PAUSE_MS = 2000`.
- **screenshot**: non-fullPage clip from `Page.getLayoutMetrics` scaled
  `min(1, tw/cw, th/ch)`; annotate → numbered overlay + annotation boxes in
  structuredContent.
- **run**: the TS version injects the live session into `AsyncFunction` — not directly
  portable. **Phase B ships `run` via `rquickjs`** (QuickJS bindings): a sandboxed JS
  context exposing an async `browser` bridge object (`pages.list/newPage/close/getInfo`,
  `observe(p).snapshot/diff/resolveRef`, `input(p).click/fill/type/press/hover/
  selectOption/scroll`, `nav(p).goto/back/forward/reload`, `cdp`, `cdpJsonForPage`) +
  captured `console`, JSON-safe value coercion, timeout race. If rquickjs integration
  balloons, ship `run` returning a structured `{ok:false, error:"run is not yet
  supported in the Rust server"}` and file a follow-up — do not block the crate on it.
- Untrusted fencing (`wrap_untrusted`) on all page-derived text; `run` output is NOT
  fenced (TS parity).

## rmcp specifics

- `BrowserMcpService` implements `ServerHandler`: capabilities `{logging:{}, tools:{listChanged:true}}`,
  no-op `logging/setLevel`, instructions = the TS `BROWSER_MCP_INSTRUCTIONS` text.
- Tools are registered through a **runtime registry** (Vec of tool descriptors with
  schemars-generated schemas), not one giant `#[tool_router]` impl — claw-server-rust
  needs to wrap each call in its interceptor pipeline and filter/annotate per session, so
  the catalog must be data, not codegen. (rmcp supports manual `list_tools`/`call_tool`
  implementations; the macros are optional.)
- Output-file tracking: TS used AsyncLocalStorage; Rust uses the explicit
  `ToolCtx.output_files` handle (an `Arc<Mutex<HashSet<PathBuf>>>` owned by the caller).
