#!/usr/bin/env npx tsx
/**
 * OpenClaw SKILL.md -> OWeb ao_skills importer.
 *
 * Standalone CLI — does not modify lovable-chat.ts.
 * Writes draft ao_skills rows for review in Settings -> Skills.
 */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, join, relative } from "node:path";

import mappings from "./mappings.json";

export type OpenClawSkillFrontmatter = {
  name?: string;
  description?: string;
  "user-invocable"?: boolean;
  metadata?: {
    openclaw?: {
      emoji?: string;
      requires?: { config?: string[] };
    };
  };
};

export type AoSkillInsert = {
  name: string;
  description: string | null;
  content: string;
  status: "draft";
  enabled: false;
  source: "openclaw-import";
  pattern_key: string | null;
  metadata?: Record<string, unknown>;
};

function parseSkillMd(raw: string): { frontmatter: OpenClawSkillFrontmatter; body: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: raw.trim() };

  const yaml = match[1]!;
  const body = match[2]!.trim();
  const frontmatter: OpenClawSkillFrontmatter = {};

  for (const line of yaml.split("\n")) {
    const nameMatch = line.match(/^name:\s*(.+)$/);
    if (nameMatch) frontmatter.name = nameMatch[1]!.replace(/^["']|["']$/g, "");
    const descMatch = line.match(/^description:\s*(.+)$/);
    if (descMatch) frontmatter.description = descMatch[1]!.replace(/^["']|["']$/g, "");
    const metaMatch = line.match(/^metadata:\s*(.+)$/);
    if (metaMatch) {
      try {
        const parsed = JSON.parse(metaMatch[1]!.replace(/'/g, '"'));
        frontmatter.metadata =
          parsed && typeof parsed === "object" && "openclaw" in (parsed as object)
            ? (parsed as OpenClawSkillFrontmatter["metadata"])
            : { openclaw: parsed as OpenClawSkillFrontmatter["metadata"] extends { openclaw?: infer T } ? T : never };
      } catch {
        /* ignore complex metadata */
      }
    }
  }

  return { frontmatter, body };
}

export function rewriteSkillBody(body: string): string {
  let out = body;

  for (const pattern of mappings.stripPatterns ?? []) {
    out = out.replace(new RegExp(pattern, "gi"), "");
  }

  for (const rule of mappings.toolActionRewrites ?? []) {
    if ("replace" in rule && rule.replace) {
      out = out.replace(new RegExp(rule.match, "gi"), rule.replace);
    }
  }

  out = out.replace(/Use the `([a-z_-]+)` tool/gi, (_m, tool: string) => {
    const kit = (mappings.extensionToComposioToolkit as Record<string, string>)[tool.toLowerCase()];
    return kit
      ? `Use Composio toolkit \`${kit}\` via \`search_tools\` then \`invoke_tool\``
      : `Use connected integrations (search_tools) for ${tool}`;
  });

  return out.replace(/\n{3,}/g, "\n\n").trim();
}

export function buildPrerequisitesSection(requires: string[] | undefined): string {
  if (!requires?.length) return "";
  const hints = mappings.openclawRequiresToIntegrationHint as Record<string, string>;
  const lines = requires.map((r) => `- **${r}**: ${hints[r] ?? `Connect ${r} in Integrations.`}`);
  return `\n\n## Prerequisites (mapped from OpenClaw)\n${lines.join("\n")}`;
}

export function convertOpenClawSkill(raw: string, opts?: { sourcePath?: string }): AoSkillInsert {
  const { frontmatter, body } = parseSkillMd(raw);
  const emoji = frontmatter.metadata?.openclaw?.emoji;
  const requires = frontmatter.metadata?.openclaw?.requires?.config;
  const name = frontmatter.name ?? basename(opts?.sourcePath ?? "imported-skill");
  const description = [emoji, frontmatter.description].filter(Boolean).join(" ") || null;

  const rewritten = rewriteSkillBody(body);
  const prereq = buildPrerequisitesSection(requires);
  const content = `${rewritten}${prereq}\n\n---\n_Imported from OpenClaw${opts?.sourcePath ? `: ${opts.sourcePath}` : ""}. Review tool names before enabling._`;

  const patternKey = createHash("sha256").update(`openclaw:${name}`).digest("hex").slice(0, 32);

  return {
    name,
    description,
    content,
    status: "draft",
    enabled: false,
    source: "openclaw-import",
    pattern_key: patternKey,
    metadata: { openclaw_requires: requires, import_path: opts?.sourcePath },
  };
}

function findSkillFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...findSkillFiles(full));
    else if (entry === "SKILL.md") out.push(full);
  }
  return out;
}

function main() {
  const args = process.argv.slice(2);
  const inputIdx = args.indexOf("--input");
  const outputIdx = args.indexOf("--output");
  const dryRun = args.includes("--dry-run");

  if (inputIdx === -1) {
    console.error("Usage: import.ts --input <file-or-dir> [--output out.json] [--dry-run]");
    process.exit(1);
  }

  const input = args[inputIdx + 1]!;
  const st = statSync(input);
  const files = st.isDirectory() ? findSkillFiles(input) : [input];
  const converted = files.map((f) => {
    const raw = readFileSync(f, "utf8");
    return convertOpenClawSkill(raw, { sourcePath: relative(process.cwd(), f) });
  });

  if (dryRun) {
    console.log(JSON.stringify(converted, null, 2));
    return;
  }

  const outPath = outputIdx !== -1 ? args[outputIdx + 1]! : "./tmp/openclaw-imported-skills.json";
  writeFileSync(outPath, JSON.stringify(converted, null, 2));
  console.log(`Wrote ${converted.length} skill(s) to ${outPath}`);
  console.log("Apply via Settings -> Skills import API or Supabase admin.");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
