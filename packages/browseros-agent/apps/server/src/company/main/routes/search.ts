import { zValidator } from '@hono/zod-validator'
import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { events } from '../../db/schema/events.sql.js'
import { threads } from '../../db/schema/threads.sql.js'
import { getDb } from '../db-singleton.js'

const querySchema = z.object({
  q: z.string().min(2).max(200),
  limit: z.coerce.number().int().min(1).max(50).default(20),
})

// `%` and `_` are LIKE wildcards; a search for `100%` would silently
// match everything without escape. We backslash-escape them and pair
// the query with `ESCAPE '\\'` so SQLite treats them as literals.
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (m) => `\\${m}`)
}

interface ThreadHit {
  id: string
  title: string
  employeeId: string
  updatedAt: number
}

interface MessageHit {
  // events.id — stable hit identifier for React keys.
  id: string
  // The turn's requestId (extracted from payload). The palette
  // passes this as the `msg` URL param; ChatSurface scrolls to the
  // matching `data-turn-id` anchor and pulses it. We jump to the
  // turn rather than the exact event block because the renderer
  // doesn't anchor blocks individually — close-enough is fine for
  // search.
  turnRequestId: string
  threadId: string
  threadTitle: string
  employeeId: string
  // 'user' for prompts (turn.start), employeeId for assistant
  // replies (text.end). Renderer renders 'you' for 'user' and falls
  // back to the employees cache for everything else.
  authorId: string
  body: string
  createdAt: number
}

export const searchRoute = new Hono().get(
  '/search',
  zValidator('query', querySchema),
  async (c) => {
    const { q, limit } = c.req.valid('query')
    const db = getDb()
    const pattern = `%${escapeLike(q)}%`

    // Three independent reads — issue them in parallel via
    // Promise.all so total latency is bounded by the slowest single
    // query rather than the sum. libsql + WAL handles concurrent
    // read transactions cleanly; sequential awaits here just
    // serialise the JS event loop for no benefit.
    const [threadRows, assistantRows, userRows] = await Promise.all([
      // Threads matched by title. Cheap LIKE over a non-indexed text
      // column; titles are short, the table is small, no FTS needed
      // at v1 scale.
      db
        .select({
          id: threads.id,
          title: threads.title,
          employeeId: threads.employeeId,
          updatedAt: threads.updatedAt,
        })
        .from(threads)
        .where(
          and(
            isNull(threads.archivedAt),
            sql`${threads.title} LIKE ${pattern} ESCAPE '\\'`,
          ),
        )
        .orderBy(desc(threads.updatedAt))
        .limit(limit),

      // Messages live in the events log, not the messages table —
      // text.end carries the assembled assistant text per block;
      // turn.start carries the user's prompt. Both are JSON-encoded
      // strings in `payload`; we pull the searchable field with
      // json_extract for the WHERE and again for the response body.
      //
      // The kind filter is important: text.delta events store the
      // streaming chunks and would inflate results 50-100×. We only
      // want the terminal payloads.
      db
        .select({
          id: events.id,
          threadId: events.threadId,
          threadTitle: threads.title,
          employeeId: threads.employeeId,
          ts: events.ts,
          body: sql<string>`json_extract(${events.payload}, '$.text')`.as(
            'body',
          ),
          turnRequestId:
            sql<string>`json_extract(${events.payload}, '$.requestId')`.as(
              'turn_request_id',
            ),
        })
        .from(events)
        .innerJoin(threads, eq(threads.id, events.threadId))
        .where(
          and(
            eq(events.kind, 'text.end'),
            isNull(threads.archivedAt),
            sql`json_extract(${events.payload}, '$.text') LIKE ${pattern} ESCAPE '\\'`,
          ),
        )
        .orderBy(desc(events.ts))
        .limit(limit),

      db
        .select({
          id: events.id,
          threadId: events.threadId,
          threadTitle: threads.title,
          employeeId: threads.employeeId,
          ts: events.ts,
          body: sql<string>`json_extract(${events.payload}, '$.userMessage')`.as(
            'body',
          ),
          turnRequestId:
            sql<string>`json_extract(${events.payload}, '$.requestId')`.as(
              'turn_request_id',
            ),
        })
        .from(events)
        .innerJoin(threads, eq(threads.id, events.threadId))
        .where(
          and(
            eq(events.kind, 'turn.start'),
            isNull(threads.archivedAt),
            sql`json_extract(${events.payload}, '$.userMessage') LIKE ${pattern} ESCAPE '\\'`,
          ),
        )
        .orderBy(desc(events.ts))
        .limit(limit),
    ])

    // Merge + re-sort. Each side capped at `limit` so the combined
    // worst case is 2×limit before the final clip.
    const merged: MessageHit[] = [
      ...assistantRows.map((r) => ({
        id: r.id,
        turnRequestId: r.turnRequestId ?? '',
        threadId: r.threadId,
        threadTitle: r.threadTitle,
        employeeId: r.employeeId,
        authorId: r.employeeId,
        body: r.body ?? '',
        createdAt: r.ts.getTime(),
      })),
      ...userRows.map((r) => ({
        id: r.id,
        turnRequestId: r.turnRequestId ?? '',
        threadId: r.threadId,
        threadTitle: r.threadTitle,
        employeeId: r.employeeId,
        authorId: 'user',
        body: r.body ?? '',
        createdAt: r.ts.getTime(),
      })),
    ]
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit)

    const threadHits: ThreadHit[] = threadRows.map((t) => ({
      ...t,
      updatedAt: t.updatedAt.getTime(),
    }))

    return c.json({ threads: threadHits, messages: merged })
  },
)
