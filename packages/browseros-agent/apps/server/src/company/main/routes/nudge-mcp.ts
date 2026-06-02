import { StreamableHTTPTransport } from '@hono/mcp'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { and, desc, eq, inArray } from 'drizzle-orm'
import { Hono } from 'hono'
import { nanoid } from 'nanoid'
import { z } from 'zod'
import { events } from '../../db/schema/events.sql.js'
import { EventSink } from '../chat/event-sink.js'
import { NUDGE_THREAD_ID_HEADER } from '../chat/nudge-mcp-server.js'
import { getDb } from '../db-singleton.js'

// In-process MCP server exposing one tool: suggest_app_connection.
// The tool handler emits an `mcp.connect_required` event directly into
// the thread's EventSink and returns a short "wait" message to the
// LLM. Direct emission is required because acpx-ai-provider@0.0.4
// collapses MCP `tool-result` parts to a status string — we can't
// recover the original JSON payload from the AI SDK stream.

const NUDGE_DESCRIPTION = [
  'Call this tool whenever the user asks for a task that needs a third-party',
  'service (Linear, Gmail, Slack, GitHub, Notion, Jira, Figma, Salesforce,',
  'Google Calendar/Docs/Drive/Sheets, LinkedIn, Airtable, Confluence,',
  'HubSpot, Stripe, PostHog, Mixpanel, Discord, Cal.com, Resend, Zendesk,',
  'Intercom, Asana, ClickUp, Monday, Microsoft Teams, Outlook Mail/Calendar,',
  'Supabase, Vercel, Postman, Cloudflare, Brave Search, Mem0, Dropbox,',
  'OneDrive, WordPress, YouTube, Box, WhatsApp, Shopify, Google Forms) and',
  'either:',
  '  (a) a connector check (e.g. browseros/connector_mcp_servers) reports',
  '      the service as not connected, OR',
  '  (b) a tool call against that service returns 401 / Unauthorized, OR',
  '  (c) any response surfaces an authUrl / apiKeyUrl / "authorize here" link.',
  '',
  'CRITICAL output rules:',
  '  - Your response must contain ONLY this tool call.',
  '  - Do NOT include any text before or after the tool call.',
  '  - Do NOT paste the auth URL into your reply. The UI renders an',
  '    interactive connect card from this tool call — pasting the URL',
  '    in text would duplicate the prompt and confuse the user.',
  '',
  'After this tool returns, STOP and wait for the user. They will reply',
  '"I\'ve connected X, continue..." once authorization completes — at that',
  'point retry the original tool call.',
].join('\n')

const inputSchema = {
  appName: z
    .string()
    .min(1)
    .describe(
      'The display name of the toolkit to connect, e.g. "Linear", "Gmail", "Slack". Match the casing of the BrowserOS catalog (proper-case, space-separated).',
    ),
  reason: z
    .string()
    .min(1)
    .describe(
      'A short user-facing rationale for the connection request, e.g. "to read your Linear issues" or "to send the Slack message you asked for". One sentence.',
    ),
}

// Returns the requestId of the latest in-flight turn for this thread,
// or null if no turn is currently streaming. A turn is "in flight" when
// its turn.start row has no matching turn.end / turn.cancel / error
// with the same requestId. Read in reverse-seq order so we stop at the
// most recent terminal-or-start event.
async function findActiveRequestId(threadId: string): Promise<string | null> {
  const db = getDb()
  const rows = await db
    .select({ kind: events.kind, payload: events.payload })
    .from(events)
    .where(
      and(
        eq(events.threadId, threadId),
        inArray(events.kind, [
          'turn.start',
          'turn.end',
          'turn.cancel',
          'error',
        ]),
      ),
    )
    .orderBy(desc(events.seq))
    .limit(1)
  const latest = rows[0]
  if (!latest || latest.kind !== 'turn.start') return null
  try {
    const parsed = JSON.parse(latest.payload) as { requestId?: string }
    return parsed.requestId ?? null
  } catch {
    return null
  }
}

export const nudgeMcpRoute = new Hono().post('/mcp/nudge', async (c) => {
  const threadId = c.req.header(NUDGE_THREAD_ID_HEADER) ?? null
  const server = new McpServer(
    { name: 'browserclaw-nudge', version: '0.0.1' },
    {
      instructions:
        'Single-tool MCP server. Calling suggest_app_connection renders an interactive connect card to the user; STOP and wait for their reply afterwards.',
    },
  )

  // @ts-ignore TS2589: MCP SDK registerTool generic instantiates excessively
  // deep under the native TS checker (tsgo); runtime is unaffected.
  server.registerTool(
    'suggest_app_connection',
    { description: NUDGE_DESCRIPTION, inputSchema },
    async (args) => {
      if (!threadId) {
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: 'Nudge tool called without an X-BrowserClaw-Thread-Id header. The connect card cannot be rendered for this session.',
            },
          ],
        }
      }
      const requestId = await findActiveRequestId(threadId)
      if (!requestId) {
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: 'No in-flight turn found for this thread. The connect card cannot be attached to the current conversation.',
            },
          ],
        }
      }
      const sink = new EventSink(getDb(), threadId)
      await sink.emit({
        type: 'mcp.connect_required',
        payload: {
          requestId,
          // Fresh id so the renderer's dedup uses this card's identity
          // rather than the upstream acpx tool-call id (which we don't
          // see at the handler layer).
          toolCallId: nanoid(),
          toolkit: args.appName,
          reason: args.reason,
        },
      })
      return {
        content: [
          {
            type: 'text' as const,
            text: `Connect card for ${args.appName} shown to the user. STOP — do not produce any further text. Wait for the user's next message before continuing.`,
          },
        ],
      }
    },
  )

  const transport = new StreamableHTTPTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  })
  await server.connect(transport)
  return (await transport.handleRequest(c)) ?? c.body(null, 204)
})
