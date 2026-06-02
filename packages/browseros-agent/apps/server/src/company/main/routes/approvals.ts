import { zValidator } from '@hono/zod-validator'
import { and, desc, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { type Approval, approvals } from '../../db/schema/approvals.sql.js'
import { threads } from '../../db/schema/threads.sql.js'
import { getDb } from '../db-singleton.js'

const resolveSchema = z.object({
  status: z.enum(['approved', 'rejected']),
})

function serialize(row: Approval) {
  return {
    ...row,
    createdAt: row.createdAt.getTime(),
    resolvedAt: row.resolvedAt?.getTime() ?? null,
  }
}

export const approvalsRoute = new Hono()
  .get('/approvals', async (c) => {
    const db = getDb()
    const rows = await db
      .select()
      .from(approvals)
      .orderBy(desc(approvals.createdAt))
    return c.json(rows.map(serialize))
  })
  .get('/approvals/pending', async (c) => {
    const db = getDb()
    const rows = await db
      .select()
      .from(approvals)
      .where(eq(approvals.status, 'pending'))
      .orderBy(desc(approvals.createdAt))
    return c.json(rows.map(serialize))
  })
  .post(
    '/approvals/:id/resolve',
    zValidator('json', resolveSchema),
    async (c) => {
      const db = getDb()
      const id = c.req.param('id')
      const { status } = c.req.valid('json')
      const now = new Date()
      const updated = await db
        .update(approvals)
        .set({ status, resolvedAt: now })
        .where(and(eq(approvals.id, id), eq(approvals.status, 'pending')))
        .returning()
      const row = updated[0]
      if (!row) {
        return c.json({ error: 'not found or already resolved' }, 404)
      }
      await db
        .update(threads)
        .set({ status: 'idle', updatedAt: now })
        .where(
          and(
            eq(threads.id, row.surfaceId),
            eq(threads.status, 'awaiting_approval'),
          ),
        )
      return c.json(serialize(row))
    },
  )
