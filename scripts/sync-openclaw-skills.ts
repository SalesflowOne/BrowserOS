#!/usr/bin/env npx tsx
/**
 * Sync OpenClaw SKILL.md files from a local openclaw clone into ao_skills JSON seeds.
 *
 * Usage:
 *   npx tsx scripts/sync-openclaw-skills.ts --openclaw /tmp/openclaw --output skills/import-openclaw/bundled
 */
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

import { convertOpenClawSkill } from "../skills/import-openclaw/import.js";

const PRIORITY_SKILLS = [
  "extensions/browser/skills/browser-automation/SKILL.md",
  "extensions/slack/skills/slack/SKILL.md",
  "extensions/discord/skills/discord/SKILL.md",
  "extensions/voice-call/skills/voice-call/SKILL.md",
  "extensions/tavily/skills/tavily/SKILL.md",
  "extensions/telegram/skills/telegram/SKILL.md",
];

function main() {
  const args = process.argv.slice(2);
  const openclawIdx = args.indexOf("--openclaw");
  const outputIdx = args.indexOf("--output");

  if (openclawIdx === -1) {
    console.error("Usage: sync-openclaw-skills.ts --openclaw <path> [--output dir]");
    process.exit(1);
  }

  const openclawRoot = args[openclawIdx + 1]!;
  const outputDir = outputIdx !== -1 ? args[outputIdx + 1]! : "skills/import-openclaw/bundled";

  mkdirSync(outputDir, { recursive: true });

  const converted = [];
  const skipped: string[] = [];

  for (const rel of PRIORITY_SKILLS) {
    const full = join(openclawRoot, rel);
    try {
      statSync(full);
      const raw = readFileSync(full, "utf8");
      const skill = convertOpenClawSkill(raw, { sourcePath: rel });
      converted.push(skill);
      const outName = `${skill.name.replace(/[^a-z0-9_-]/gi, "_")}.json`;
      writeFileSync(join(outputDir, outName), JSON.stringify(skill, null, 2));
      console.log(`✓ ${rel} → ${outName}`);
    } catch {
      skipped.push(rel);
      console.warn(`✗ skip ${rel} (not found)`);
    }
  }

  writeFileSync(join(outputDir, "_manifest.json"), JSON.stringify({
    syncedAt: new Date().toISOString(),
    count: converted.length,
    skills: converted.map((s) => s.name),
    skipped,
  }, null, 2));

  console.log(`\nWrote ${converted.length} skill(s) to ${outputDir}`);
}

main();
