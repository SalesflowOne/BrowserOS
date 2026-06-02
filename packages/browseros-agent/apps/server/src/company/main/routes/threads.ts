// biome-ignore-all lint/nursery/noExcessiveLinesPerFile: this file owns the full /threads HTTP surface (list, get, create, patch, seen, permission/resolve, plus the small buildThreadPatch helper). Splitting per-endpoint fragments the route table; the per-endpoint comments + shared schemas read more clearly as one unit.
import { zValidator } from '@hono/zod-validator'
import { and, asc, desc, eq, isNull, lt } from 'drizzle-orm'
import { Hono } from 'hono'
import { nanoid } from 'nanoid'
import { z } from 'zod'
import {
  DEFAULT_THREAD_TITLE,
  type Thread,
  threads,
} from '../../db/schema/threads.sql.js'
import {
  PERMISSION_DECISIONS,
  PERMISSION_MODES,
} from '../../shared/permission.js'
import { resolvePending as resolvePendingPermission } from '../chat/permission-callback.js'
import { getSessionManager } from '../chat/sessionManager.js'
import { getDb } from '../db-singleton.js'
import { getDefaultPermissionMode } from '../settings/permission.js'
import {
  loadTelegramLinks,
  serializeThreadWithLink,
} from '../telegram/thread-links.js'

const createSchema = z.object({
  title: z.string().min(1).max(120).optional(),
  parentThreadId: z.string().min(1).nullable().optional(),
  createdByParticipantId: z.string().min(1).optional(),
  // Per-thread permission mode chosen on the new-thread screen.
  // Falls back to the app-wide default when absent.
  permissionMode: z.enum(PERMISSION_MODES).optional(),
})

// PATCH /threads/:id accepts any subset of these fields. Composer
// picker changes call this with override fields (without title);
// the rename UI calls it with title (without overrides). Either
// works; nothing is mandatory.
const patchSchema = z.object({
  title: z.string().min(1).max(120).optional(),
  agentKindOverride: z.string().nullable().optional(),
  modelIdOverride: z.string().nullable().optional(),
  reasoningEffortOverride: z.string().nullable().optional(),
  workspacePathOverride: z.string().nullable().optional(),
  // Per-thread permission mode for the acpx onPermissionRequest gate.
  // Mutated by the chat-header picker; resolvePermissionMode reads
  // this on each turn start, with the settings default as fallback.
  permissionMode: z.enum(PERMISSION_MODES).optional(),
  // Soft-archive marker (epoch ms). Non-null hides from rail; null
  // restores it. No archive UI yet, so restore is API-only for now.
  archivedAt: z.number().nullable().optional(),
})

const serialize = (row: Thread) => serializeThreadWithLink(row, null)

export const threadsRoute = new Hono()
  .get('/employees/:employeeId/threads', async (c) => {
    const db = getDb()
    const employeeId = c.req.param('employeeId')
    // Default ordering stays ASC-by-createdAt so existing callers
    // (e.g. Thread.tsx's general-thread resolver) keep their semantics.
    // The rail's "Show more" passes `order=updatedDesc` + a `before`
    // cursor to page through older threads.
    const order =
      c.req.query('order') === 'updatedDesc' ? 'updatedDesc' : 'createdAsc'
    const beforeParam = c.req.query('before')
    const before = beforeParam ? Number.parseInt(beforeParam, 10) : null
    const limitParam = c.req.query('limit')
    const limit = limitParam
      ? Math.max(1, Math.min(200, Number.parseInt(limitParam, 10)))
      : null

    const filters =
      before !== null && Number.isFinite(before)
        ? and(
            eq(threads.employeeId, employeeId),
            isNull(threads.archivedAt),
            lt(threads.updatedAt, new Date(before)),
          )
        : and(eq(threads.employeeId, employeeId), isNull(threads.archivedAt))
    const orderBy =
      order === 'updatedDesc' ? desc(threads.updatedAt) : asc(threads.createdAt)
    const query = db.select().from(threads).where(filters).orderBy(orderBy)
    const rows = limit ? await query.limit(limit) : await query
    const links = await loadTelegramLinks(rows.map((r) => r.id))
    return c.json(
      rows.map((r) => serializeThreadWithLink(r, links.get(r.id) ?? null)),
    )
  })
  .get('/threads/:id', async (c) => {
    const db = getDb()
    const id = c.req.param('id')
    const row = await db
      .select()
      .from(threads)
      .where(eq(threads.id, id))
      .limit(1)
    const thread = row[0]
    if (!thread) return c.json({ error: 'not found' }, 404)
    const links = await loadTelegramLinks([thread.id])
    return c.json(serializeThreadWithLink(thread, links.get(thread.id) ?? null))
  })
  .post(
    '/employees/:employeeId/threads',
    zValidator('json', createSchema),
    async (c) => {
      const db = getDb()
      const employeeId = c.req.param('employeeId')
      const input = c.req.valid('json')
      const id = nanoid()
      const now = new Date()
      // Snapshot the current default permission mode onto the row at
      // create time, unless the client supplied an explicit mode
      // (new-thread screen staging). Bumping the app default later
      // does not retroactively change existing threads; the user opts
      // into the new default for old threads via the per-thread picker.
      const permissionMode =
        input.permissionMode ?? (await getDefaultPermissionMode(db))
      const row: Thread = {
        id,
        employeeId,
        title: input.title?.trim() || DEFAULT_THREAD_TITLE,
        isGeneral: false,
        parentThreadId: input.parentThreadId ?? null,
        createdByParticipantId: input.createdByParticipantId ?? 'user',
        status: 'idle',
        acpxSessionId: null,
        agentKindOverride: null,
        modelIdOverride: null,
        reasoningEffortOverride: null,
        workspacePathOverride: null,
        permissionMode,
        createdAt: now,
        updatedAt: now,
        archivedAt: null,
        lastSeenAt: null,
      }
      await db.insert(threads).values(row)
      return c.json(serialize(row), 201)
    },
  )
  .patch('/threads/:id', zValidator('json', patchSchema), async (c) => {
    const db = getDb()
    const id = c.req.param('id')
    const body = c.req.valid('json')

    const patch = buildThreadPatch(body)
    const updated = await db
      .update(threads)
      .set(patch)
      .where(eq(threads.id, id))
      .returning()
    const row = updated[0]
    if (!row) return c.json({ error: 'not found' }, 404)

    // Push the new mode into the live ChatSession if one exists, so
    // the callback's getter reads it on the very next escalation. No-
    // op when no session is alive — the resolver will pick the new
    // value up from the DB at the next send() anyway.
    if (body.permissionMode !== undefined) {
      const session = getSessionManager().get(id)
      session?.setPermissionMode(body.permissionMode)
    }
    return c.json(serialize(row))
  })
  // Resolves an in-flight permission escalation. The renderer's
  // PermissionApprovalCard POSTs here when the user clicks Approve /
  // Deny / Approve-don't-ask-again / Deny-don't-ask-again. Returns
  // 409 if the registry has no pending entry for this id — handles
  // double-click and late-arriving clicks after turn.cancel drained
  // the registry. The matching permission.resolved event lands on
  // the SSE stream from the callback's finalize path; this handler
  // does not emit it directly.
  .post(
    '/threads/:id/permission/:requestId',
    zValidator('json', z.object({ outcome: z.enum(PERMISSION_DECISIONS) })),
    (c) => {
      const id = c.req.param('id')
      const requestId = c.req.param('requestId')
      const { outcome } = c.req.valid('json')
      const ok = resolvePendingPermission(id, requestId, { outcome })
      if (!ok) return c.json({ error: 'request not pending' }, 409)
      return c.json({ ok: true })
    },
  )
  // Bump lastSeenAt so the rail's "attention" indicator clears for
  // this thread. Idempotent — sending it twice is a no-op the second
  // time because we only compare strictly greater (`ts > lastSeenAt`)
  // when deriving rail status. Fired from ChatSurface mount and any
  // surface that "opens" a thread for the user.
  .post('/threads/:id/seen', async (c) => {
    const db = getDb()
    const id = c.req.param('id')
    const now = new Date()
    const updated = await db
      .update(threads)
      .set({ lastSeenAt: now })
      .where(eq(threads.id, id))
      .returning({ id: threads.id, lastSeenAt: threads.lastSeenAt })
    const row = updated[0]
    if (!row) return c.json({ error: 'not found' }, 404)
    return c.json({
      id: row.id,
      lastSeenAt: row.lastSeenAt?.getTime() ?? null,
    })
  })

type ThreadPatchBody = z.infer<typeof patchSchema>

// Translate the validated request body into the column-set object
// drizzle wants. Extracted to keep the route handler under the
// cognitive-complexity ceiling — adding fields here doesn't push the
// handler past the limit.
function buildThreadPatch(
  body: ThreadPatchBody,
): Record<string, string | null | Date> {
  const patch: Record<string, string | null | Date> = {
    updatedAt: new Date(),
  }
  if (body.title !== undefined) patch.title = body.title
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
  if (body.permissionMode !== undefined) {
    patch.permissionMode = body.permissionMode
  }
  if (body.archivedAt !== undefined) {
    patch.archivedAt =
      body.archivedAt === null ? null : new Date(body.archivedAt)
  }
  return patch
}
