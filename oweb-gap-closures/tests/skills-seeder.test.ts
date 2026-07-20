import { describe, expect, it } from "vitest";

import {
  generateAoSkillsSql,
  loadBundledSkills,
  toAoSkillRows,
} from "../src/integration/skills-seeder.js";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const bundledDir = join(dirname(fileURLToPath(import.meta.url)), "../../skills/import-openclaw/bundled");

describe("skills-seeder", () => {
  it("loads bundled skills", () => {
    const skills = loadBundledSkills(bundledDir);
    expect(skills.length).toBeGreaterThanOrEqual(5);
    expect(skills.some((s) => s.name === "slack")).toBe(true);
  });

  it("generates SQL inserts", () => {
    const skills = loadBundledSkills(bundledDir).slice(0, 1);
    const rows = toAoSkillRows("00000000-0000-0000-0000-000000000001", skills);
    const sql = generateAoSkillsSql(rows);
    expect(sql).toContain("INSERT INTO ao_skills");
    expect(sql).toContain("browser-automation");
  });
});
