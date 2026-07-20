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
    minScore?: number;
  }): Promise<MemorySearchResult>;
  remember(params: {
    orgId: string;
    label: string;
    content: string;
    kind?: string;
    metadata?: Record<string, unknown>;
  }): Promise<MemoryEntity>;
  /** Read a memory entity by id with optional line range (OpenClaw memory_get parity). */
  get?(params: {
    orgId: string;
    id: string;
    fromLine?: number;
    maxLines?: number;
  }): Promise<MemoryEntity | null>;
};

export type McpToolDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>, ctx: { orgId: string }) => Promise<unknown>;
};

export function createMemoryMcpTools(store: MemoryStore): McpToolDefinition[] {
  const tools: McpToolDefinition[] = [
    {
      name: "memory_search",
      description:
        "Search the organization's memory graph for relevant facts, preferences, and prior context. " +
        "Run this before answering questions that may depend on org-specific knowledge.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Natural language search query" },
          limit: { type: "number", description: "Max results (default 10)" },
          minScore: { type: "number", description: "Minimum relevance score 0-1" },
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

  if (store.get) {
    tools.push({
      name: "memory_get",
      description:
        "Read a specific memory entity by ID. Use after memory_search when you need the full content.",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Memory entity ID from memory_search" },
          fromLine: { type: "number", description: "Start line (1-based)" },
          maxLines: { type: "number", description: "Max lines to return" },
        },
        required: ["id"],
      },
      handler: async (args, ctx) => {
        const id = String(args.id ?? "").trim();
        if (!id) throw new Error("id is required");
        const entity = await store.get!({
          orgId: ctx.orgId,
          id,
          fromLine: typeof args.fromLine === "number" ? args.fromLine : undefined,
          maxLines: typeof args.maxLines === "number" ? args.maxLines : undefined,
        });
        if (!entity) return { found: false };
        return {
          found: true,
          id: entity.id,
          label: entity.label,
          kind: entity.kind,
          content: entity.content,
        };
      },
    });
  }

  return tools;
}

/** System prompt section — adapted from OpenClaw memory-core prompt-section.ts */
export function buildMemoryPromptSection(): string {
  return [
    "## Memory",
    "Before answering questions about preferences, prior decisions, or org-specific facts, run `memory_search`.",
    "When you learn durable facts the user wants remembered, call `memory_remember`.",
    "Use `memory_get` to read full content for a specific memory ID when search snippets are insufficient.",
  ].join("\n");
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
    async get({ orgId, id, fromLine, maxLines }) {
      const entity = entities.find((e) => e.orgId === orgId && e.id === id);
      if (!entity) return null;
      if (!fromLine && !maxLines) return entity;
      const lines = entity.content.split("\n");
      const start = Math.max(0, (fromLine ?? 1) - 1);
      const end = maxLines ? start + maxLines : lines.length;
      return { ...entity, content: lines.slice(start, end).join("\n") };
    },
  };
}
