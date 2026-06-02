// biome-ignore-all lint/nursery/noExcessiveLinesPerFile: CRUD + messages + SSE + MCP in one file — one place to grep the channel surface
import { zValidator } from '@hono/zod-validator'
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { nanoid } from 'nanoid'
import { z } from 'zod'
import { channelMembers } from '../../db/schema/channel_members.sql.js'
import { channels } from '../../db/schema/channels.sql.js'
import { employees } from '../../db/schema/employees.sql.js'
import { messages } from '../../db/schema/messages.sql.js'
import { attachmentSchema } from '../../shared/attachments.js'
import { ensureAppWindow } from '../browseros/app-window.js'
import { createSurfaceTabGroup } from '../browseros/tab-group.js'
import { handleChannelMcpRequest } from '../channels/mcp-server.js'
import { getChannelOrchestrator } from '../channels/orchestrator.js'
import { loadMemberIds } from '../channels/orchestrator-store.js'
import {
  type ChannelEvent,
  messageRowToTranscriptEntry,
} from '../channels/types.js'
import { formatAttachmentBlock } from '../chat/attachments.js'
import { getDb } from '../db-singleton.js'
import { getBrowserosMcpUrl } from '../settings/browseros.js'

const CHANNEL_NAME_RE = /^[a-z0-9][a-z0-9-]{0,49}$/

const createSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(50)
    .regex(
      CHANNEL_NAME_RE,
      'Channel name must be lowercase letters, digits, hyphens (max 50 chars).',
    ),
  topic: z.string().max(200).optional(),
  leadEmployeeId: z.string().min(1),
  memberIds: z
    .array(z.string().min(1))
    .min(1, 'A channel needs at least one member.')
    .max(50),
  createdByParticipantId: z.string().min(1).optional(),
})

const patchSchema = z.object({
  name: z.string().min(1).max(50).regex(CHANNEL_NAME_RE).optional(),
  topic: z.string().max(200).nullable().optional(),
  leadEmployeeId: z.string().min(1).optional(),
})

const addMemberSchema = z.object({ employeeId: z.string().min(1) })

const postMessageSchema = z.object({
  text: z.string().min(1).max(8000),
  to: z.string().min(1).optional(),
  attachments: z.array(attachmentSchema).max(20).optional(),
})

function serializeChannel(row: typeof channels.$inferSelect) {
  return {
    ...row,
    archivedAt: row.archivedAt ? row.archivedAt.getTime() : null,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  }
}

/** "Alex (Project Manager) — moves features through review" style.
 *  Falls back to the bare id when the employee row is missing so a
 *  dangling ref doesn't crash the system-row pipeline. */
async function formatEmployeeForSystemRow(employeeId: string): Promise<string> {
  const db = getDb()
  const rows = await db
    .select({
      name: employees.name,
      role: employees.role,
      tagline: employees.tagline,
    })
    .from(employees)
    .where(eq(employees.id, employeeId))
    .limit(1)
  const profile = rows[0]
  if (!profile) return `@${employeeId}`
  const taglineSuffix = profile.tagline?.trim()
    ? ` — ${profile.tagline.trim()}`
    : ''
  return `${profile.name} (${profile.role})${taglineSuffix}`
}

export const channelsRoute = new Hono()
  .post('/channels', zValidator('json', createSchema), async (c) => {
    const db = getDb()
    const input = c.req.valid('json')
    // Lead must be in the member set.
    if (!input.memberIds.includes(input.leadEmployeeId)) {
      return c.json(
        { error: 'leadEmployeeId must be one of the selected members.' },
        400,
      )
    }
    // Validate that every member id refers to a real employee row.
    const employeeRows = await db.select({ id: employees.id }).from(employees)
    const known = new Set(employeeRows.map((e) => e.id))
    const missing = input.memberIds.filter((id) => !known.has(id))
    if (missing.length > 0) {
      return c.json(
        { error: `Unknown employee id(s): ${missing.join(', ')}` },
        400,
      )
    }
    // Unique-name conflict surfaces as a constraint error; pre-check
    // for a cleaner message.
    const existingNamed = await db
      .select({ id: channels.id })
      .from(channels)
      .where(eq(channels.name, input.name))
      .limit(1)
    if (existingNamed.length > 0) {
      return c.json({ error: `Channel "${input.name}" already exists.` }, 409)
    }

    const now = new Date()
    const id = nanoid()
    const row = {
      id,
      name: input.name,
      topic: input.topic ?? null,
      leadEmployeeId: input.leadEmployeeId,
      createdByParticipantId: input.createdByParticipantId ?? 'user',
      archivedAt: null,
      tabGroupId: null as string | null,
      createdAt: now,
      updatedAt: now,
    }
    await db.insert(channels).values(row)
    // Eager tab-group bootstrap — mirrors the hire flow. Best-effort.
    try {
      const browserosUrl = await getBrowserosMcpUrl(db)
      const appWindowId = await ensureAppWindow(db, browserosUrl)
      const tabGroupId = await createSurfaceTabGroup(
        browserosUrl,
        appWindowId,
        { kind: 'channel', id: row.id, name: row.name, tint: 'blue' },
      )
      await db
        .update(channels)
        .set({ tabGroupId })
        .where(eq(channels.id, row.id))
      row.tabGroupId = tabGroupId
    } catch (err) {
      // biome-ignore lint/suspicious/noConsole: tab group bootstrap is non-fatal; lazy ensure will retry on first tool call
      console.warn(
        `[channels.create] tab group bootstrap failed for ${row.id}; will retry lazily:`,
        err,
      )
    }
    await db.insert(channelMembers).values(
      // Dedup memberIds before insert; user could submit dupes.
      Array.from(new Set(input.memberIds)).map((employeeId) => ({
        channelId: id,
        employeeId,
        addedAt: now,
      })),
    )
    return c.json(
      {
        ...serializeChannel(row),
        memberIds: Array.from(new Set(input.memberIds)),
        memberCount: new Set(input.memberIds).size,
        lastActivityAt: null,
      },
      201,
    )
  })
  .get('/channels', async (c) => {
    const db = getDb()
    const includeArchived = c.req.query('includeArchived') === 'true'
    const baseQuery = db.select().from(channels)
    const channelRows = includeArchived
      ? await baseQuery.orderBy(desc(channels.updatedAt))
      : await baseQuery
          .where(isNull(channels.archivedAt))
          .orderBy(desc(channels.updatedAt))

    if (channelRows.length === 0) return c.json([])

    // Hydrate member counts + lastActivityAt in two follow-up queries.
    const memberCountRows = await db
      .select({
        channelId: channelMembers.channelId,
        count: sql<number>`count(*)`.as('count'),
      })
      .from(channelMembers)
      .groupBy(channelMembers.channelId)
    const memberCountByChannel = new Map<string, number>()
    for (const r of memberCountRows) {
      memberCountByChannel.set(r.channelId, Number(r.count))
    }

    const lastActivityRows = await db
      .select({
        channelId: messages.surfaceId,
        latest: sql<number>`max(${messages.createdAt})`.as('latest'),
      })
      .from(messages)
      .where(eq(messages.surface, 'channel'))
      .groupBy(messages.surfaceId)
    const lastActivityByChannel = new Map<string, number>()
    for (const r of lastActivityRows) {
      lastActivityByChannel.set(r.channelId, Number(r.latest))
    }

    const result = channelRows.map((row) => ({
      ...serializeChannel(row),
      memberCount: memberCountByChannel.get(row.id) ?? 0,
      lastActivityAt: lastActivityByChannel.get(row.id) ?? null,
    }))
    return c.json(result)
  })
  .get('/channels/:id', async (c) => {
    const db = getDb()
    const id = c.req.param('id')
    const rows = await db
      .select()
      .from(channels)
      .where(eq(channels.id, id))
      .limit(1)
    const channel = rows[0]
    if (!channel) return c.json({ error: 'not found' }, 404)
    const memberIds = await loadMemberIds(id)
    return c.json({
      ...serializeChannel(channel),
      memberIds,
    })
  })
  .patch('/channels/:id', zValidator('json', patchSchema), async (c) => {
    const db = getDb()
    const id = c.req.param('id')
    const input = c.req.valid('json')

    const rows = await db
      .select()
      .from(channels)
      .where(eq(channels.id, id))
      .limit(1)
    const channel = rows[0]
    if (!channel) return c.json({ error: 'not found' }, 404)

    const built = await buildChannelPatch(id, input)
    if ('error' in built) return c.json({ error: built.error }, 400)
    const patch = built.patch

    const updated = await db
      .update(channels)
      .set(patch)
      .where(eq(channels.id, id))
      .returning()
    const next = updated[0]
    if (!next) return c.json({ error: 'not found' }, 404)
    if (
      input.leadEmployeeId !== undefined &&
      input.leadEmployeeId !== channel.leadEmployeeId
    ) {
      const lead = await formatEmployeeForSystemRow(input.leadEmployeeId)
      await getChannelOrchestrator().appendSystemMessage(
        id,
        `Channel lead changed to ${lead}.`,
      )
    }
    return c.json(serializeChannel(next))
  })
  .post('/channels/:id/archive', async (c) => {
    const db = getDb()
    const id = c.req.param('id')
    const now = new Date()
    const updated = await db
      .update(channels)
      .set({ archivedAt: now, updatedAt: now })
      .where(eq(channels.id, id))
      .returning()
    if (updated.length === 0) return c.json({ error: 'not found' }, 404)
    await getChannelOrchestrator().disposeChannel(id)
    return c.json({ ok: true })
  })
  .post(
    '/channels/:id/members',
    zValidator('json', addMemberSchema),
    async (c) => {
      const db = getDb()
      const id = c.req.param('id')
      const { employeeId } = c.req.valid('json')
      const channelRows = await db
        .select()
        .from(channels)
        .where(eq(channels.id, id))
        .limit(1)
      if (channelRows.length === 0) {
        return c.json({ error: 'not found' }, 404)
      }
      const employeeRows = await db
        .select({ id: employees.id })
        .from(employees)
        .where(eq(employees.id, employeeId))
        .limit(1)
      if (employeeRows.length === 0) {
        return c.json({ error: `Unknown employee: ${employeeId}` }, 400)
      }
      // Insert idempotently.
      const existing = await db
        .select()
        .from(channelMembers)
        .where(
          and(
            eq(channelMembers.channelId, id),
            eq(channelMembers.employeeId, employeeId),
          ),
        )
        .limit(1)
      if (existing.length === 0) {
        await db
          .insert(channelMembers)
          .values({ channelId: id, employeeId, addedAt: new Date() })
        const profile = await formatEmployeeForSystemRow(employeeId)
        await getChannelOrchestrator().appendSystemMessage(
          id,
          `${profile} joined the channel.`,
        )
      }
      const memberIds = await loadMemberIds(id)
      return c.json({ memberIds })
    },
  )
  .delete('/channels/:id/members/:employeeId', async (c) => {
    const db = getDb()
    const id = c.req.param('id')
    const employeeId = c.req.param('employeeId')
    const channelRows = await db
      .select()
      .from(channels)
      .where(eq(channels.id, id))
      .limit(1)
    const channel = channelRows[0]
    if (!channel) return c.json({ error: 'not found' }, 404)
    if (channel.leadEmployeeId === employeeId) {
      return c.json(
        {
          error:
            'Cannot remove the channel lead. Reassign the lead first via PATCH /channels/:id.',
        },
        400,
      )
    }
    const deleted = await db
      .delete(channelMembers)
      .where(
        and(
          eq(channelMembers.channelId, id),
          eq(channelMembers.employeeId, employeeId),
        ),
      )
      .returning()
    if (deleted.length === 0) {
      return c.json({ error: 'member not found' }, 404)
    }
    const profile = await formatEmployeeForSystemRow(employeeId)
    await getChannelOrchestrator().appendSystemMessage(
      id,
      `${profile} left the channel.`,
    )
    const memberIds = await loadMemberIds(id)
    return c.json({ memberIds })
  })
  .get('/channels/:id/messages', async (c) => {
    const db = getDb()
    const id = c.req.param('id')
    const rows = await db
      .select()
      .from(messages)
      .where(and(eq(messages.surface, 'channel'), eq(messages.surfaceId, id)))
      .orderBy(asc(messages.createdAt))
    return c.json(rows.map(messageRowToTranscriptEntry))
  })
  .post(
    '/channels/:id/messages',
    zValidator('json', postMessageSchema),
    (c) => {
      const id = c.req.param('id')
      const orchestrator = getChannelOrchestrator()
      const { text, to, attachments } = c.req.valid('json')
      const prefix = formatAttachmentBlock(attachments ?? [])
      void orchestrator
        .postFromUser(id, `${prefix}${text}`, to)
        .catch((err) => {
          // biome-ignore lint/suspicious/noConsole: drain failure surfaces once; SSE subscribers see the resulting turn.end with status='error' for the active turn
          console.warn(`[channels:${id}] postFromUser failed:`, err)
        })
      return c.json({ accepted: true }, 202)
    },
  )
  .post('/channels/:id/stop', async (c) => {
    // Founder-initiated cancellation. Aborts every in-flight turn in
    // the channel, drops needsWake flags so no fresh turn fires off a
    // tool-call that lands during cleanup, appends one
    // "Stopped by founder." system row. Safe to call when nothing is
    // in flight — returns `{ interrupted: false }`.
    const id = c.req.param('id')
    const result = await getChannelOrchestrator().interrupt(id)
    return c.json({ ok: true as const, ...result })
  })
  .get('/channels/:id/events', (c) => {
    const id = c.req.param('id')
    return streamSSE(c, async (stream) => {
      const queue: ChannelEvent[] = []
      let live = false
      const unsubscribe = getChannelOrchestrator().subscribe(id, (event) => {
        if (live) {
          void stream.writeSSE({
            id: String(event.seq),
            event: event.kind,
            data: JSON.stringify(event),
          })
        } else {
          queue.push(event)
        }
      })
      try {
        live = true
        for (const event of queue) {
          await stream.writeSSE({
            id: String(event.seq),
            event: event.kind,
            data: JSON.stringify(event),
          })
        }
        await new Promise<void>((resolve) => {
          stream.onAbort(() => resolve())
        })
      } finally {
        unsubscribe()
      }
    })
  })
  .all('/channels/:id/mcp', async (c) => {
    return handleChannelMcpRequest(c.req.raw)
  })

type PatchResult =
  | { error: string }
  | { patch: Partial<typeof channels.$inferInsert> }

async function buildChannelPatch(
  channelId: string,
  input: z.infer<typeof patchSchema>,
): Promise<PatchResult> {
  const patch: Partial<typeof channels.$inferInsert> = { updatedAt: new Date() }
  if (input.name !== undefined) patch.name = input.name
  if (input.topic !== undefined) patch.topic = input.topic
  if (input.leadEmployeeId !== undefined) {
    const memberIds = await loadMemberIds(channelId)
    if (!memberIds.includes(input.leadEmployeeId)) {
      return { error: 'New lead must be a current member of the channel.' }
    }
    patch.leadEmployeeId = input.leadEmployeeId
  }
  if (Object.keys(patch).length === 1) return { error: 'no fields to update' }
  return { patch }
}
