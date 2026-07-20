/**
 * Agent-facing memory tools over ao_entities / memory graph.
 * Expose via custom MCP or merge into chat tool registry.
 */

export type MemoryEntity = {
  id: string;
  orgId: string;
  kind: string;
  label: string;
  content: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type MemorySearchResult = {
  entities: MemoryEntity[];
  total: number;
};

export type MemoryStore = {
  search(params: {
    orgId: string;
    query: string;
    limit?: number;
    kinds?: string[];
  }): Promise<MemorySearchResult>;
  remember(params: {
    orgId: string;
    label: string;
    content: string;
    kind?: string;
    metadata?: Record<string, unknown>;
  }): Promise<MemoryEntity>;
};

export type McpToolDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>, ctx: { orgId: string }) => Promise<unknown>;
};

export function createMemoryMcpTools(store: MemoryStore): McpToolDefinition[] {
  return [
    {
      name: "memory_search",
      description:
        "Search the organization's memory graph for relevant facts, preferences, and prior context.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Natural language search query" },
          limit: { type: "number", description: "Max results (default 10)" },
          kinds: {
            type: "array",
            items: { type: "string" },
            description: "Optional entity kinds to filter",
          },
        },
        required: ["query"],
      },
      handler: async (args, ctx) => {
        const query = String(args.query ?? "");
        if (!query.trim()) throw new Error("query is required");
        const result = await store.search({
          orgId: ctx.orgId,
          query,
          limit: typeof args.limit === "number" ? args.limit : 10,
          kinds: Array.isArray(args.kinds) ? args.kinds.map(String) : undefined,
        });
        return {
          total: result.total,
          entities: result.entities.map((e) => ({
            id: e.id,
            kind: e.kind,
            label: e.label,
            content: e.content,
            metadata: e.metadata,
          })),
        };
      },
    },
    {
      name: "memory_remember",
      description:
        "Store a durable fact or preference in the organization's memory graph for future sessions.",
      inputSchema: {
        type: "object",
        properties: {
          label: { type: "string", description: "Short title for the memory" },
          content: { type: "string", description: "Full memory content" },
          kind: { type: "string", description: "Entity kind (default: memory)" },
          metadata: { type: "object", description: "Optional structured metadata" },
        },
        required: ["label", "content"],
      },
      handler: async (args, ctx) => {
        const label = String(args.label ?? "").trim();
        const content = String(args.content ?? "").trim();
        if (!label || !content) throw new Error("label and content are required");
        const entity = await store.remember({
          orgId: ctx.orgId,
          label,
          content,
          kind: args.kind ? String(args.kind) : "memory",
          metadata:
            args.metadata && typeof args.metadata === "object"
              ? (args.metadata as Record<string, unknown>)
              : undefined,
        });
        return { id: entity.id, label: entity.label, kind: entity.kind };
      },
    },
  ];
}

/** In-memory store for tests and local dev. Replace with memory-graph.server.ts adapter in OWeb. */
export function createInMemoryMemoryStore(): MemoryStore {
  const entities: MemoryEntity[] = [];
  let seq = 1;

  return {
    async search({ orgId, query, limit = 10, kinds }) {
      const q = query.toLowerCase();
      const filtered = entities.filter((e) => {
        if (e.orgId !== orgId) return false;
        if (kinds?.length && !kinds.includes(e.kind)) return false;
        return (
          e.label.toLowerCase().includes(q) ||
          e.content.toLowerCase().includes(q) ||
          e.kind.toLowerCase().includes(q)
        );
      });
      return { entities: filtered.slice(0, limit), total: filtered.length };
    },
    async remember({ orgId, label, content, kind = "memory", metadata }) {
      const now = new Date().toISOString();
      const entity: MemoryEntity = {
        id: `mem_${seq++}`,
        orgId,
        kind,
        label,
        content,
        metadata,
        createdAt: now,
        updatedAt: now,
      };
      entities.push(entity);
      return entity;
    },
  };
}
