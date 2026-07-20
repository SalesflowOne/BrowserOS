/**
 * Skills seeder — import bundled OpenClaw playbooks into ao_skills.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import type { AoSkillRow } from "./types.js";

export type BundledSkill = {
  name: string;
  description: string | null;
  content: string;
  status: "draft" | "active";
  enabled: boolean;
  source: string;
  pattern_key: string | null;
  metadata?: Record<string, unknown>;
};

export function loadBundledSkills(bundledDir: string): BundledSkill[] {
  const files = readdirSync(bundledDir).filter((f) => f.endsWith(".json") && !f.startsWith("_"));
  return files.map((f) => {
    const raw = readFileSync(join(bundledDir, f), "utf8");
    return JSON.parse(raw) as BundledSkill;
  });
}

export function toAoSkillRows(orgId: string, skills: BundledSkill[]): AoSkillRow[] {
  return skills.map((s) => ({
    org_id: orgId,
    name: s.name,
    description: s.description,
    content: s.content,
    status: s.status,
    enabled: s.enabled,
    source: s.source,
    pattern_key: s.pattern_key,
    metadata: s.metadata,
  }));
}

export function generateAoSkillsSql(rows: AoSkillRow[]): string {
  const statements = rows.map((row) => {
    const esc = (v: string | null) =>
      v === null ? "NULL" : `'${v.replace(/'/g, "''")}'`;
    const metadata = row.metadata ? `'${JSON.stringify(row.metadata).replace(/'/g, "''")}'::jsonb` : "NULL";
    return `INSERT INTO ao_skills (org_id, name, description, content, status, enabled, source, pattern_key, metadata)
VALUES (${esc(row.org_id)}::uuid, ${esc(row.name)}, ${esc(row.description)}, ${esc(row.content)}, ${esc(row.status)}, ${row.enabled}, ${esc(row.source)}, ${esc(row.pattern_key)}, ${metadata})
ON CONFLICT (org_id, pattern_key) WHERE pattern_key IS NOT NULL
DO UPDATE SET description = EXCLUDED.description, content = EXCLUDED.content, updated_at = now();`;
  });
  return statements.join("\n\n");
}

export function generateAoSkillsApiPayload(orgId: string, skills: BundledSkill[]) {
  return {
    orgId,
    skills: skills.map((s) => ({
      ...s,
      org_id: orgId,
    })),
  };
}
