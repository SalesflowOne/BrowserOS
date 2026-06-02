import { eq } from 'drizzle-orm'
import { settings } from '../../db/schema/settings.sql.js'
import type { DB } from '../../db/types.js'
import { type McpServer, mcpRegistrySchema } from './mcp-registry.schema.js'

export const MCP_REGISTRY_SETTING_KEY = 'mcp.servers'

/** Reads the user-managed MCP server registry. Missing row → empty array. */
export async function readMcpRegistry(db: DB): Promise<McpServer[]> {
  const rows = await db
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, MCP_REGISTRY_SETTING_KEY))
    .limit(1)
  const raw = rows[0]?.value
  if (!raw) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    // Corrupted JSON falls back to an empty list rather than crashing the
    // settings load; the user can re-add servers from the UI.
    return []
  }
  const result = mcpRegistrySchema.safeParse(parsed)
  return result.success ? result.data : []
}

/** Validates the incoming list and overwrites the registry row in place. */
export async function writeMcpRegistry(
  db: DB,
  servers: McpServer[],
): Promise<McpServer[]> {
  const validated = mcpRegistrySchema.parse(servers)
  const now = new Date()
  await db
    .insert(settings)
    .values({
      key: MCP_REGISTRY_SETTING_KEY,
      value: JSON.stringify(validated),
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value: JSON.stringify(validated), updatedAt: now },
    })
  return validated
}
