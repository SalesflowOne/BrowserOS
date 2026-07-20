import { describe, expect, it, vi } from "vitest";

import { createOwebMcpBundle, registerMcpBundleOnServer } from "../src/integration/mcp-bundle.js";
import { createInMemoryMemoryStore } from "../src/mcp/memory-tools.server.js";

describe("mcp-bundle", () => {
  it("creates memory tools with prompt section", () => {
    const bundle = createOwebMcpBundle({
      memoryStore: createInMemoryMemoryStore(),
    });
    expect(bundle.tools.some((t) => t.name === "memory_search")).toBe(true);
    expect(bundle.promptSections[0]).toContain("memory_search");
  });

  it("registers on MCP server", async () => {
    const registered: string[] = [];
    const server = {
      tool: (name: string) => {
        registered.push(name);
      },
    };
    const bundle = createOwebMcpBundle({
      memoryStore: createInMemoryMemoryStore(),
      namespace: "oweb",
    });
    registerMcpBundleOnServer(server, bundle, () => ({ orgId: "org_1" }));
    expect(registered).toContain("oweb_memory_search");
  });
});
