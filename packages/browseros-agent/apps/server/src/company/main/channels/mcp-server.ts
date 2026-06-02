// MCP server exposing the `messageEmployee` tool. Headers are set by
// the channel's AcpxProvider config:
//   X-Channel-Id   — channel the caller is speaking in
//   X-Employee-Id  — calling agent's id
// The handler forwards to the orchestrator and returns immediately so
// the calling agent keeps streaming.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { z } from 'zod'
import { getChannelOrchestrator } from './orchestrator.js'

const TRANSPORT_GC_DELAY_MS = 30_000

const MESSAGE_EMPLOYEE_INPUT = {
  employee_id: z
    .string()
    .min(1)
    .describe(
      "The recipient. Use an `emp_…` id from the channel roster to wake a teammate, or the literal string `user` to brief the founder. The founder doesn't take a turn — it just lands in the channel.",
    ),
  body: z
    .string()
    .min(1)
    .describe(
      'The message body. Markdown allowed. Lead with one sentence on the ask so the recipient sees the why before the what.',
    ),
}

interface HeaderLike {
  get?: (name: string) => string | string[] | null | undefined
  [key: string]: unknown
}

function readHeader(
  headers: HeaderLike | undefined,
  name: string,
): string | null {
  if (!headers) return null
  if (typeof headers.get === 'function') {
    const value = headers.get(name)
    if (typeof value === 'string') return value
    if (Array.isArray(value) && typeof value[0] === 'string') return value[0]
  }
  const indexed = (headers as Record<string, unknown>)[name.toLowerCase()]
  if (typeof indexed === 'string') return indexed
  if (Array.isArray(indexed) && typeof indexed[0] === 'string')
    return indexed[0]
  return null
}

function buildServer(): McpServer {
  const server = new McpServer({
    name: 'browserclaw-channels',
    version: '0.2.0',
  })
  // @ts-ignore TS2589: the MCP SDK's registerTool generic instantiates
  // excessively deep on this two-param handler (RequestHandlerExtra). Runtime
  // is unaffected; the schema/handler are validated by the SDK at call time.
  server.registerTool(
    'messageEmployee',
    {
      title: 'Send a directed message in this channel',
      description: [
        'Wake a teammate (or brief the founder) with a directed message.',
        'Targets: an `emp_…` id from the channel roster, or the literal string `user` for the founder.',
        'You can call this multiple times in one turn — each call wakes that recipient in parallel.',
        "Don't block your turn waiting for their reply — finish your turn after calling.",
      ].join('\n'),
      inputSchema: MESSAGE_EMPLOYEE_INPUT,
    },
    async (args, extra) => {
      const headers = (extra.requestInfo?.headers ?? {}) as HeaderLike
      const channelId = readHeader(headers, 'x-channel-id')
      const employeeId = readHeader(headers, 'x-employee-id')
      if (!channelId || !employeeId) {
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: 'Tool invoked without required X-Channel-Id / X-Employee-Id headers.',
            },
          ],
        }
      }
      const result = await getChannelOrchestrator().receiveMessageEmployee(
        channelId,
        employeeId,
        args.employee_id,
        args.body,
      )
      if (!result.ok) {
        return {
          isError: true,
          content: [{ type: 'text' as const, text: result.error }],
        }
      }
      return {
        content: [
          {
            type: 'text' as const,
            text: `Delivered to ${args.employee_id}. End your turn now; if they take action you'll see it in the channel.`,
          },
        ],
      }
    },
  )
  return server
}

/** Stateless MCP transport: each request gets a fresh server +
 *  transport pair. Closes deferred via setTimeout so the
 *  Streamable HTTP response body has time to flush before the
 *  underlying ReadableStream is canceled. */
export async function handleChannelMcpRequest(req: Request): Promise<Response> {
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  })
  const server = buildServer()
  await server.connect(transport)
  const response = await transport.handleRequest(req)
  setTimeout(() => {
    void transport.close().catch(() => undefined)
    void server.close().catch(() => undefined)
  }, TRANSPORT_GC_DELAY_MS)
  return response
}
