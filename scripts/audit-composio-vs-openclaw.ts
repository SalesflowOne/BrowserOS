#!/usr/bin/env npx tsx
/**
 * Compare OpenClaw extension IDs to OWeb Composio marketplace slugs.
 * Read-only audit — prints a markdown table to stdout.
 *
 * Usage:
 *   npx tsx scripts/audit-composio-vs-openclaw.ts
 *   npx tsx scripts/audit-composio-vs-openclaw.ts --json
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import mappings from "../skills/import-openclaw/mappings.json";

/** Top OpenClaw extensions from https://github.com/openclaw/openclaw/tree/main/extensions */
const OPENCLAW_TOP20 = [
  { id: "brave", kind: "search" },
  { id: "browser", kind: "automation" },
  { id: "slack", kind: "channel" },
  { id: "discord", kind: "channel" },
  { id: "telegram", kind: "channel" },
  { id: "whatsapp", kind: "channel" },
  { id: "google", kind: "llm" },
  { id: "gmail", kind: "integration" },
  { id: "spotify", kind: "media" },
  { id: "memory-core", kind: "memory" },
  { id: "voice-call", kind: "voice" },
  { id: "webhooks", kind: "ingress" },
  { id: "tavily", kind: "search" },
  { id: "firecrawl", kind: "fetch" },
  { id: "perplexity", kind: "search" },
  { id: "onepassword", kind: "secrets" },
  { id: "imessage", kind: "channel" },
  { id: "signal", kind: "channel" },
  { id: "msteams", kind: "channel" },
  { id: "outlook", kind: "integration" },
] as const;

/** OWeb curated slugs from composio-marketplace.ts + composio-constants.ts */
const OWEB_COMPOSIO_SLUGS = new Set([
  "browser_tool",
  "composio_search",
  "anchor_browser",
  "firecrawl",
  "tavily",
  "slack",
  "microsoft_teams",
  "outlook",
  "discord",
  "notion",
  "hubspot",
  "salesforce",
  "linear",
  "stripe",
  "github",
  "airtable",
  "jira",
  "asana",
  "shopify",
  "twilio",
  "gmail",
  "googledrive",
  "googlecalendar",
  "googlesheets",
  "googlesuper",
  "metaads",
  "perplexityai",
  "zendesk",
  "telegram",
  "spotify",
]);

const OWEB_BUILTIN: Record<string, string> = {
  browser: "browser_tool + Anchor + browse_web",
  "memory-core": "ao_entities memory graph",
  webhooks: "platform-webhooks + Composio triggers",
  google: "AI Gateway model router",
  onepassword: "OWeb Vault",
  "voice-call": "voice TTS/STT + twilio Composio",
};

const GAPS: Record<string, string> = {
  imessage: "macOS-only channel — out of scope",
  signal: "no Signal integration",
};

type Row = {
  openclaw: string;
  kind: string;
  composioSlug: string | null;
  owebBuiltin: string | null;
  status: "covered" | "partial" | "gap";
  notes: string;
};

function resolveRow(ext: (typeof OPENCLAW_TOP20)[number]): Row {
  const mapped = (mappings.extensionToComposioToolkit as Record<string, string>)[ext.id] ?? null;
  const inMarketplace = mapped ? OWEB_COMPOSIO_SLUGS.has(mapped) : false;
  const builtin = OWEB_BUILTIN[ext.id] ?? null;
  const gap = GAPS[ext.id];

  let status: Row["status"] = "partial";
  let notes = "";

  if (gap) {
    status = "gap";
    notes = gap;
  } else if (inMarketplace || mapped === "composio_search") {
    status = "covered";
    notes = mapped ? `Composio: ${mapped}` : "";
  } else if (builtin) {
    status = mapped ? "covered" : "partial";
    notes = builtin;
  } else if (mapped) {
    status = "partial";
    notes = `Mapped to ${mapped} but not in curated marketplace`;
  } else {
    status = "gap";
    notes = "No Composio mapping";
  }

  return {
    openclaw: ext.id,
    kind: ext.kind,
    composioSlug: mapped,
    owebBuiltin: builtin,
    status,
    notes,
  };
}

function main() {
  const json = process.argv.includes("--json");
  const rows = OPENCLAW_TOP20.map(resolveRow);

  if (json) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }

  console.log("# OpenClaw vs OWeb Composio audit\n");
  console.log("| OpenClaw | Kind | Composio | Status | Notes |");
  console.log("|----------|------|----------|--------|-------|");
  for (const r of rows) {
    console.log(
      `| ${r.openclaw} | ${r.kind} | ${r.composioSlug ?? "—"} | ${r.status} | ${r.notes.replace(/\|/g, "/")} |`,
    );
  }

  const covered = rows.filter((r) => r.status === "covered").length;
  const partial = rows.filter((r) => r.status === "partial").length;
  const gap = rows.filter((r) => r.status === "gap").length;
  console.log(`\nSummary: ${covered} covered, ${partial} partial, ${gap} gap`);
}

main();
