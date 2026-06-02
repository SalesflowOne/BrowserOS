import { z } from 'zod'

// env/headers persist as [{name, value}] arrays rather than records: acpx's
// public types claim records but the runtime parses arrays, and array order
// is meaningful for some servers (e.g. duplicate header keys). The array
// shape is converted to a record only at the call into the provider — see
// buildAgentMcpServers.
const namedValueSchema = z.object({
  name: z.string().trim().min(1, 'Name is required'),
  value: z.string().min(1, 'Value is required'),
})

const stdioServerSchema = z.object({
  id: z.string().min(1),
  type: z.literal('stdio'),
  name: z.string().trim().min(1, 'Name is required'),
  command: z.string().trim().min(1, 'Command is required'),
  args: z.array(z.string()),
  env: z.array(namedValueSchema),
})

const httpServerSchema = z.object({
  id: z.string().min(1),
  type: z.enum(['http', 'sse']),
  name: z.string().trim().min(1, 'Name is required'),
  url: z
    .string()
    .url('Must be a valid URL')
    .refine(
      (value) => /^https?:\/\//i.test(value),
      'URL must use http or https',
    ),
  headers: z.array(namedValueSchema),
})

export const mcpServerSchema = z.discriminatedUnion('type', [
  stdioServerSchema,
  httpServerSchema,
])

export const mcpRegistrySchema = z
  .array(mcpServerSchema)
  .refine(
    (servers) => new Set(servers.map((s) => s.name)).size === servers.length,
    { message: 'MCP server names must be unique' },
  )

export type McpServer = z.infer<typeof mcpServerSchema>
export type McpServerNamedValue = z.infer<typeof namedValueSchema>
