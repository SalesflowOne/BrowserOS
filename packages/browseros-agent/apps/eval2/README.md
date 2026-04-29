# eval2 - Langfuse-traced eval

A minimal eval runner that runs a SingleAgent (OpenAI via
`@browseros/server`'s `AiSdkAgent`) against agisdk smoke tasks and sends each
task's spans (LLM calls, tool calls, and per-tool screenshots) to Langfuse.

Per-tool-call screenshots are uploaded as `LangfuseMedia` and rendered inline
in the trace UI.

## Prerequisites

- BrowserOS app installed at `/Applications/BrowserOS.app/Contents/MacOS/BrowserOS`
  or a custom `browserosBinary` in the config.
- Bun for running TypeScript.
- `python3` with `agisdk` installed for the grader (`pip install agisdk`).
- Env vars in `.env.development` or your shell:
  - `OPENAI_API_KEY` is required.
  - `LANGFUSE_PUBLIC_KEY` and `LANGFUSE_SECRET_KEY` enable tracing. Without
    them, the runner warns and runs without tracing.
  - `LANGFUSE_BASE_URL` is optional; defaults to `https://cloud.langfuse.com`.

## Run

```bash
cd packages/browseros-agent/apps/eval2
bun run eval --config benchmark-configs/agisdk-mini.jsonc
```

Console output includes per-task progress, a summary table, and the
`summary.json` path. If tracing is enabled, each task has a Langfuse session
like `agisdk-mini-2026-04-28-1530-dashdish-10` containing AI SDK LLM/tool-call
spans plus one `screenshot.<tool>` span per tool call with the PNG attached.

## screenshotMode

Each config's `langfuse.screenshotMode` controls per-tool screenshot capture:

- `all` - every tool call gets a screenshot (default).
- `mutating-only` - only mutating tools (click, fill, navigate, scroll, etc.).
- `never` - disable screenshots; LLM-call traces only.

## Layout

- `benchmark-configs/` contains commented JSONC configs.
- `datasets/` contains copied JSONL datasets from `apps/eval`.
- `scripts/` contains the copied Python agisdk sidecar.
- `src/` contains the TypeScript runner. `browseros-app-manager.ts`,
  `agisdk-grader.ts`, and `utils/` are copied from `apps/eval` with local path
  tweaks.

## Silo Rule

No imports from `apps/eval`. Anything needed from the original eval app is
copied into `apps/eval2`.
