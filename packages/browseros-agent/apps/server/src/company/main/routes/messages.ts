import { zValidator } from '@hono/zod-validator'
import { and, asc, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { employees } from '../../db/schema/employees.sql.js'
import { type Message, messages } from '../../db/schema/messages.sql.js'
import { threads } from '../../db/schema/threads.sql.js'
import { isAgentKind } from '../../shared/agents/capabilities.constants.js'
import { attachmentSchema } from '../../shared/attachments.js'
import { ensureAppWindow, getAppWindowId } from '../browseros/app-window.js'
import { ensureSurfaceTabGroup } from '../browseros/tab-group.js'
import { formatAttachmentBlock } from '../chat/attachments.js'
import { getSessionManager } from '../chat/sessionManager.js'
import { effectiveTuple } from '../chat/tuple.js'
import { getDb } from '../db-singleton.js'
import { getBrowserosMcpUrl } from '../settings/browseros.js'

// Accept optional tuple-override fields with each message. The
// composer sends them alongside the text whenever the user has changed
// agent / model / workspace / effort. Persisted to the thread row so
// subsequent sessions resume with the same tuple.
const sendSchema = z.object({
  text: z.string().min(1).max(8000),
  agentKindOverride: z.string().nullable().optional(),
  modelIdOverride: z.string().nullable().optional(),
  reasoningEffortOverride: z.string().nullable().optional(),
  workspacePathOverride: z.string().nullable().optional(),
  attachments: z.array(attachmentSchema).max(20).optional(),
})

function serialize(row: Message) {
  return { ...row, createdAt: row.createdAt.getTime() }
}

/**
 * Pull the tuple-override fields out of the send-message body into a
 * patch object the route can `.set()` on the threads row. Only fields
 * the client explicitly included (vs absent) make it into the patch
 * — `undefined` means "leave alone", `null` means "clear back to the
 * employee default".
 */
function buildOverridePatch(
  body: z.infer<typeof sendSchema>,
): Record<string, string | null> {
  const patch: Record<string, string | null> = {}
  if (body.agentKindOverride !== undefined) {
    patch.agentKindOverride = body.agentKindOverride
  }
  if (body.modelIdOverride !== undefined) {
    patch.modelIdOverride = body.modelIdOverride
  }
  if (body.reasoningEffortOverride !== undefined) {
    patch.reasoningEffortOverride = body.reasoningEffortOverride
  }
  if (body.workspacePathOverride !== undefined) {
    patch.workspacePathOverride = body.workspacePathOverride
  }
  return patch
}

export const messagesRoute = new Hono()
  .get('/threads/:id/messages', async (c) => {
    const db = getDb()
    const id = c.req.param('id')
    const rows = await db
      .select()
      .from(messages)
      .where(and(eq(messages.surface, 'thread'), eq(messages.surfaceId, id)))
      .orderBy(asc(messages.createdAt))
    return c.json(rows.map(serialize))
  })
  .post('/threads/:id/messages', zValidator('json', sendSchema), async (c) => {
    const threadId = c.req.param('id')
    const body = c.req.valid('json')
    const text = body.text.trim()
    if (!text) return c.json({ error: 'empty message' }, 400)

    // Validate agent kind if provided.
    if (
      body.agentKindOverride !== undefined &&
      body.agentKindOverride !== null &&
      !isAgentKind(body.agentKindOverride)
    ) {
      return c.json({ error: `Unknown agent: ${body.agentKindOverride}` }, 400)
    }

    // Persist the override columns BEFORE re-reading the row so the
    // tuple we compute below reflects the user's latest picker choice.
    // ChatSession.send routes between handoff/in-place/continuation
    // paths based on this tuple vs its currently-active tuple.
    const db = getDb()
    const overridePatch = buildOverridePatch(body)
    if (Object.keys(overridePatch).length > 0) {
      await db
        .update(threads)
        .set({ ...overridePatch, updatedAt: new Date() })
        .where(eq(threads.id, threadId))
    }

    // Re-read the row to compute the effective tuple from the just-
    // persisted overrides + employee defaults. This is the tuple the
    // session needs for this turn.
    const [threadRow] = await db
      .select()
      .from(threads)
      .where(eq(threads.id, threadId))
      .limit(1)
    if (!threadRow) {
      return c.json({ error: 'thread not found' }, 404)
    }
    const [employeeRow] = await db
      .select()
      .from(employees)
      .where(eq(employees.id, threadRow.employeeId))
      .limit(1)
    if (!employeeRow) {
      return c.json({ error: 'employee not found' }, 404)
    }
    const tuple = effectiveTuple(threadRow, employeeRow)

    // The cached ChatSession bakes the windowId + tabGroupId into its
    // MCP headers for the session's lifetime. If either was recreated
    // between turns (visibility flip, window/group death), dispose the
    // session so the next getOrStart rebuilds with fresh headers.
    try {
      const browserosUrl = await getBrowserosMcpUrl(db)
      const storedAppWindow = await getAppWindowId(db)
      const live = await ensureAppWindow(db, browserosUrl)
      let needsDispose = storedAppWindow !== null && live !== storedAppWindow
      const ensured = await ensureSurfaceTabGroup(db, browserosUrl, live, {
        kind: 'employee',
        id: employeeRow.id,
        name: employeeRow.name,
        tint: employeeRow.tint,
      })
      if (ensured.recreated) needsDispose = true
      if (needsDispose) {
        await getSessionManager().dispose(threadId)
      }
    } catch (err) {
      // BrowserOS unreachable — let the send proceed; if the agent
      // actually needs the browser the failure surfaces there.
      // biome-ignore lint/suspicious/noConsole: degraded operation, surface once
      console.warn(
        `[messages.send] browseros liveness check failed for thread ${threadId}; sending without rebuild:`,
        err,
      )
    }

    const prefix = formatAttachmentBlock(body.attachments ?? [])
    try {
      const session = await getSessionManager().getOrStart(threadId)
      const result = await session.send(`${prefix}${text}`, tuple)
      return c.json({ requestId: result.requestId })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'send failed'
      return c.json({ error: message }, 500)
    }
  })
