import { StreamableHTTPTransport } from '@hono/mcp'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { DEFAULT_THREAD_TITLE, threads } from '../../db/schema/threads.sql.js'
import { createAnnouncement } from '../announcements/createAnnouncement.js'
import { BROWSERCLAW_THREAD_ID_HEADER } from '../chat/browserclaw-mcp-server.js'
import { EventSink } from '../chat/event-sink.js'
import { getDb } from '../db-singleton.js'

// In-process MCP server for first-party tools the LLM should be able
// to call. Today: `set_thread_title` — sets a short conversation title
// on the first reply so the rail isn't a wall of "New thread". Future
// internal tools (rename other resources, status flags) share the
// `browserclaw` namespace.

const POST_ANNOUNCEMENT_DESCRIPTION =
  'Record something significant you JUST finished or shipped on the team Announcements board. ' +
  'Use ONLY for completed work: a merged PR, a published post, a completed brief, a closed incident, a sent campaign. ' +
  "Do NOT use to acknowledge a task you accepted, and do NOT use to reply to the founder's questions; reply in chat for that. " +
  'Both `title` and `body` accept GitHub-flavored markdown: bold, italic, `inline code`, [links](https://example.com), bulleted / numbered lists, and fenced code blocks. ' +
  'Prefer inline-only formatting (no headings, lists, or code blocks) in the title. Always link to source artefacts (PR, tweet, dashboard, doc) when relevant. ' +
  'One call per shipped thing. The board shows newest first; the founder reads it asynchronously.'

const postAnnouncementInputSchema = {
  title: z
    .string()
    .min(4)
    .max(120)
    .describe(
      'One-line title summarising what you shipped. Inline markdown only (bold, code, links). No headings, lists, or code blocks.',
    ),
  body: z
    .string()
    .min(20)
    .max(2000)
    .describe(
      'Two to four sentences (or a short list) explaining what you did and the outcome. Full GitHub-flavored markdown. Link to the source artefact.',
    ),
}

const TITLE_DESCRIPTION =
  'MANDATORY on your first reply in any new conversation. Call this BEFORE any other tool call and BEFORE any visible text, with a short 3-6 word title summarising the user\'s first message. The title appears in the user\'s thread sidebar — make it scannable (Title Case, no trailing punctuation, no emoji). Examples: "Calendar meetings lookup", "Refactor login flow", "Draft launch tweet", "Compare PR review tools". This is idempotent — subsequent calls are rejected once the thread has a non-default title, so you cannot overwrite a user-set name. Skip the call ONLY if you are certain the conversation already has a non-default title.'

const titleInputSchema = {
  title: z
    .string()
    .min(2)
    .max(80)
    .describe(
      'Short title for the conversation. 3–6 words, title case, no trailing punctuation. Should reflect the topic of the first user message.',
    ),
}

export const browserClawMcpRoute = new Hono().post(
  '/mcp/browserclaw',
  async (c) => {
    const threadId = c.req.header(BROWSERCLAW_THREAD_ID_HEADER) ?? null
    const server = new McpServer(
      { name: 'browserclaw', version: '0.0.1' },
      {
        instructions:
          'Internal first-party MCP server. set_thread_title sets the conversation title once on the first reply. post_announcement records shipped work on the team Announcements board (markdown enabled, completed work only).',
      },
    )

    // @ts-ignore TS2589: MCP SDK registerTool generic instantiates excessively
    // deep under the native TS checker (tsgo); runtime is unaffected.
    server.registerTool(
      'set_thread_title',
      { description: TITLE_DESCRIPTION, inputSchema: titleInputSchema },
      async (args) => {
        if (!threadId) {
          return {
            isError: true,
            content: [
              {
                type: 'text' as const,
                text: 'set_thread_title called without an X-BrowserClaw-Thread-Id header. Cannot scope the rename to a conversation.',
              },
            ],
          }
        }
        const trimmed = args.title.trim()
        if (trimmed.length < 2) {
          return {
            isError: true,
            content: [
              {
                type: 'text' as const,
                text: 'Title is too short after trimming. Provide 3–6 descriptive words.',
              },
            ],
          }
        }

        // Atomic check-then-write so two parallel calls can't both win
        // — first one through "claims" the title, second sees it's no
        // longer the default and is rejected by the guard.
        const db = getDb()
        const { committed, title } = await db.transaction(async (tx) => {
          const [row] = await tx
            .select({ title: threads.title })
            .from(threads)
            .where(eq(threads.id, threadId))
            .limit(1)
          if (!row) return { committed: false, title: null as string | null }
          if (row.title !== DEFAULT_THREAD_TITLE) {
            return { committed: false, title: row.title }
          }
          await tx
            .update(threads)
            .set({ title: trimmed, updatedAt: new Date() })
            .where(eq(threads.id, threadId))
          return { committed: true, title: trimmed }
        })

        if (!committed) {
          if (title === null) {
            return {
              isError: true,
              content: [
                {
                  type: 'text' as const,
                  text: `Thread ${threadId} not found.`,
                },
              ],
            }
          }
          return {
            content: [
              {
                type: 'text' as const,
                text: `Title already set to "${title}". Do not call set_thread_title again on this conversation.`,
              },
            ],
          }
        }

        // Tell the renderer to patch its cached thread row's title in
        // place — the rail listens on the SSE stream for this event
        // and updates without a refetch.
        const sink = new EventSink(getDb(), threadId)
        await sink.emit({
          type: 'thread.title_changed',
          payload: { threadId, title: trimmed },
        })

        return {
          content: [
            {
              type: 'text' as const,
              text: `Title set to "${trimmed}". Continue with the user's request.`,
            },
          ],
        }
      },
    )

    server.registerTool(
      'post_announcement',
      {
        description: POST_ANNOUNCEMENT_DESCRIPTION,
        inputSchema: postAnnouncementInputSchema,
      },
      async (args) => {
        if (!threadId) {
          return {
            isError: true,
            content: [
              {
                type: 'text' as const,
                text: 'post_announcement called without an X-BrowserClaw-Thread-Id header. Cannot attribute the post to an employee.',
              },
            ],
          }
        }

        // Resolve the calling employee from the thread the tool is
        // scoped to. We don't trust an LLM-supplied employeeId; the
        // thread's owner is the only correct attribution.
        const db = getDb()
        const [thread] = await db
          .select({ employeeId: threads.employeeId })
          .from(threads)
          .where(eq(threads.id, threadId))
          .limit(1)
        if (!thread) {
          return {
            isError: true,
            content: [
              {
                type: 'text' as const,
                text: `Thread ${threadId} not found; cannot post announcement.`,
              },
            ],
          }
        }

        const result = await createAnnouncement(db, {
          employeeId: thread.employeeId,
          title: args.title,
          body: args.body,
          threadId,
        })
        if (!result.ok) {
          return {
            isError: true,
            content: [
              {
                type: 'text' as const,
                text: `Employee ${thread.employeeId} no longer exists; cannot post announcement.`,
              },
            ],
          }
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: `Posted to Announcements (id ${result.row.id}). The founder will see it on the board.`,
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
  },
)
