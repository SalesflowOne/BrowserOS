/**
 * Unified MCP tool bundle — memory + Twilio Voice for OWeb custom MCP merge.
 */
import {
  buildMemoryPromptSection,
  createMemoryMcpTools,
  type MemoryStore,
  type McpToolDefinition,
} from "../mcp/memory-tools.server.js";
import {
  createTwilioVoiceMcpTools,
  type TwilioVoiceConfig,
} from "../mcp/twilio-voice.server.js";

export type McpToolContext = { orgId: string };

export type RegisteredMcpTool = McpToolDefinition & {
  /** Namespace prefix when merging into MCP server */
  namespace?: string;
};

export function createOwebMcpBundle(opts: {
  memoryStore: MemoryStore;
  twilioVoice?: TwilioVoiceConfig | null;
  namespace?: string;
}): { tools: RegisteredMcpTool[]; promptSections: string[] } {
  const ns = opts.namespace ?? "oweb";
  const tools: RegisteredMcpTool[] = [];

  for (const t of createMemoryMcpTools(opts.memoryStore)) {
    tools.push({ ...t, namespace: ns });
  }

  if (opts.twilioVoice) {
    for (const t of createTwilioVoiceMcpTools(opts.twilioVoice)) {
      tools.push({ ...t, namespace: ns });
    }
  }

  return {
    tools,
    promptSections: [buildMemoryPromptSection()],
  };
}

/** Register tools on an MCP-like server with a `tool(name, schema, handler)` method */
export function registerMcpBundleOnServer(
  server: {
    tool: (
      name: string,
      description: string,
      schema: Record<string, unknown>,
      handler: (args: Record<string, unknown>) => Promise<unknown>,
    ) => void;
  },
  bundle: ReturnType<typeof createOwebMcpBundle>,
  getContext: () => McpToolContext,
): void {
  for (const t of bundle.tools) {
    const name = t.namespace ? `${t.namespace}_${t.name}` : t.name;
    server.tool(name, t.description, t.inputSchema, async (args) =>
      t.handler(args, getContext()),
    );
  }
}

export function mcpToolsToOpenAiFunctions(bundle: ReturnType<typeof createOwebMcpBundle>) {
  return bundle.tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.namespace ? `${t.namespace}_${t.name}` : t.name,
      description: t.description,
      parameters: t.inputSchema,
    },
  }));
}
