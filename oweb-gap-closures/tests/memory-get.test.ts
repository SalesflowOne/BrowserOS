import { describe, expect, it, vi } from "vitest";

import { buildMemoryPromptSection, createInMemoryMemoryStore, createMemoryMcpTools } from "../src/mcp/memory-tools.server.js";

describe("memory_get", () => {
  it("reads entity by id with line range", async () => {
    const store = createInMemoryMemoryStore();
    const tools = createMemoryMcpTools(store);
    const remember = tools.find((t) => t.name === "memory_remember")!;
    const get = tools.find((t) => t.name === "memory_get")!;

    const saved = (await remember.handler(
      { label: "Notes", content: "line1\nline2\nline3" },
      { orgId: "org_1" },
    )) as { id: string };

    const result = (await get.handler(
      { id: saved.id, fromLine: 2, maxLines: 1 },
      { orgId: "org_1" },
    )) as { found: boolean; content: string };

    expect(result.found).toBe(true);
    expect(result.content).toBe("line2");
  });

  it("builds memory prompt section", () => {
    expect(buildMemoryPromptSection()).toContain("memory_search");
  });
});
