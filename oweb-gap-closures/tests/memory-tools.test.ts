import { describe, expect, it } from "vitest";

import {
  createInMemoryMemoryStore,
  createMemoryMcpTools,
} from "../src/mcp/memory-tools.server.js";

describe("memory-tools", () => {
  it("remembers and searches entities", async () => {
    const store = createInMemoryMemoryStore();
    const tools = createMemoryMcpTools(store);
    const remember = tools.find((t) => t.name === "memory_remember")!;
    const search = tools.find((t) => t.name === "memory_search")!;

    await remember.handler(
      { label: "Favorite coffee", content: "Oat milk flat white" },
      { orgId: "org_1" },
    );

    const result = (await search.handler({ query: "coffee" }, { orgId: "org_1" })) as {
      total: number;
      entities: { label: string }[];
    };

    expect(result.total).toBe(1);
    expect(result.entities[0]?.label).toBe("Favorite coffee");
  });

  it("scopes search by org", async () => {
    const store = createInMemoryMemoryStore();
    const tools = createMemoryMcpTools(store);
    const remember = tools.find((t) => t.name === "memory_remember")!;
    const search = tools.find((t) => t.name === "memory_search")!;

    await remember.handler({ label: "A", content: "secret" }, { orgId: "org_a" });
    const result = (await search.handler({ query: "secret" }, { orgId: "org_b" })) as {
      total: number;
    };
    expect(result.total).toBe(0);
  });
});
