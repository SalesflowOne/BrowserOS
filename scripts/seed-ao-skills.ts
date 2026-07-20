#!/usr/bin/env npx tsx
/**
 * Seed bundled OpenClaw skills into ao_skills.
 *
 * Usage:
 *   npx tsx scripts/seed-ao-skills.ts --org <uuid> [--sql] [--output file.sql]
 *   npx tsx scripts/seed-ao-skills.ts --org <uuid> --api https://oweb.one/api/admin/skills --key $ADMIN_KEY
 */
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  generateAoSkillsApiPayload,
  generateAoSkillsSql,
  loadBundledSkills,
  toAoSkillRows,
} from "../oweb-gap-closures/src/integration/skills-seeder.js";

const __dir = dirname(fileURLToPath(import.meta.url));
const BUNDLED_DIR = join(__dir, "../skills/import-openclaw/bundled");

async function main() {
  const args = process.argv.slice(2);
  const orgIdx = args.indexOf("--org");
  const apiIdx = args.indexOf("--api");
  const keyIdx = args.indexOf("--key");
  const outputIdx = args.indexOf("--output");
  const sql = args.includes("--sql");

  if (orgIdx === -1) {
    console.error(
      "Usage: seed-ao-skills.ts --org <uuid> [--sql] [--output file.sql] [--api URL --key TOKEN]",
    );
    process.exit(1);
  }

  const orgId = args[orgIdx + 1]!;
  const skills = loadBundledSkills(BUNDLED_DIR);
  const rows = toAoSkillRows(orgId, skills);

  if (apiIdx !== -1) {
    const apiUrl = args[apiIdx + 1]!;
    const key = keyIdx !== -1 ? args[keyIdx + 1]! : process.env.OWEB_ADMIN_KEY ?? "";
    const payload = generateAoSkillsApiPayload(orgId, skills);
    const res = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      console.error(`API error ${res.status}:`, await res.text());
      process.exit(1);
    }
    console.log(`Seeded ${skills.length} skills via API for org ${orgId}`);
    return;
  }

  const sqlText = generateAoSkillsSql(rows);
  if (sql || outputIdx !== -1) {
    const outPath = outputIdx !== -1 ? args[outputIdx + 1]! : `ao_skills_${orgId}.sql`;
    writeFileSync(outPath, sqlText);
    console.log(`Wrote ${skills.length} INSERT statements to ${outPath}`);
    return;
  }

  console.log(JSON.stringify(rows, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
