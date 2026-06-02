import { and, asc, eq, gt } from 'drizzle-orm'
import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { type ChatEvent, events } from '../../db/schema/events.sql.js'
import { getEventBus } from '../chat/eventBus.js'
import { getSessionManager } from '../chat/sessionManager.js'
import { getDb } from '../db-singleton.js'

function serialize(row: ChatEvent): string {
  return JSON.stringify({
    id: row.id,
    seq: row.seq,
    kind: row.kind,
    payload: JSON.parse(row.payload),
    ts: row.ts.getTime(),
  })
}

export const threadEventsRoute = new Hono()
  .get('/threads/:id/events', async (c) => {
    const db = getDb()
    const threadId = c.req.param('id')
    // EventSource sends Last-Event-ID on reconnect. Use it as the seq
    // cursor so we replay only the events the client hasn't seen.
    const lastEventId = c.req.header('Last-Event-ID')
    const startSeq = lastEventId ? Number.parseInt(lastEventId, 10) : -1
    const cursor = Number.isFinite(startSeq) ? startSeq : -1

    return streamSSE(c, async (stream) => {
      const queue: ChatEvent[] = []
      let live = false
      const unsubscribe = getEventBus().subscribe(threadId, (event) => {
        if (live) {
          void stream.writeSSE({
            id: String(event.seq),
            event: event.kind,
            data: serialize(event),
          })
        } else {
          queue.push(event)
        }
      })

      try {
        // Replay history from the cursor forward, in seq order.
        const history = await db
          .select()
          .from(events)
          .where(eq(events.threadId, threadId))
          .orderBy(asc(events.seq))
        for (const row of history) {
          if (row.seq <= cursor) continue
          await stream.writeSSE({
            id: String(row.seq),
            event: row.kind,
            data: serialize(row),
          })
        }
        // Drain any events that arrived while replaying.
        live = true
        for (const event of queue) {
          await stream.writeSSE({
            id: String(event.seq),
            event: event.kind,
            data: serialize(event),
          })
        }
        // Keep the connection open until the client disconnects.
        await new Promise<void>((resolve) => {
          stream.onAbort(() => resolve())
        })
      } finally {
        unsubscribe()
      }
    })
  })
  .post('/threads/:id/interrupt', (c) => {
    const threadId = c.req.param('id')
    const session = getSessionManager().get(threadId)
    if (!session) return c.json({ ok: true, interrupted: false })
    session.interrupt()
    return c.json({ ok: true, interrupted: true })
  })
  // GET historical events as JSON — useful for non-streaming consumers
  // and lets the renderer also pre-warm the React Query cache.
  .get('/threads/:id/events.json', async (c) => {
    const db = getDb()
    const threadId = c.req.param('id')
    const sinceParam = c.req.query('since')
    const since = sinceParam ? Number.parseInt(sinceParam, 10) : -1
    const cursor = Number.isFinite(since) ? since : -1
    const where =
      cursor >= 0
        ? and(eq(events.threadId, threadId), gt(events.seq, cursor))
        : eq(events.threadId, threadId)
    const rows = await db
      .select()
      .from(events)
      .where(where)
      .orderBy(asc(events.seq))
    return c.json(
      rows.map((row) => ({
        id: row.id,
        seq: row.seq,
        kind: row.kind,
        payload: JSON.parse(row.payload),
        ts: row.ts.getTime(),
      })),
    )
  })
