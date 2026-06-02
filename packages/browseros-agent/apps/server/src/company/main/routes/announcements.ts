import { desc } from 'drizzle-orm'
import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import {
  type Announcement,
  announcements,
} from '../../db/schema/announcements.sql.js'
import { getAnnouncementBus } from '../announcements/announcementBus.js'
import { getDb } from '../db-singleton.js'

// Wire shape exposed to the renderer. `postedAt` is unwrapped to a
// number (ms epoch) so the client doesn't need a Date hydration step.
function serialize(row: Announcement) {
  return {
    id: row.id,
    employeeId: row.employeeId,
    threadId: row.threadId,
    turnRequestId: row.turnRequestId,
    title: row.title,
    body: row.body,
    postedAt: row.postedAt.getTime(),
  }
}

// Soft cap shared by the GET endpoint and the SSE replay so a cold
// open of the board sees the same page either way.
const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200
const STREAM_REPLAY_LIMIT = 50

function clampLimit(raw: string | undefined): number {
  const parsed = Number.parseInt(raw ?? String(DEFAULT_LIMIT), 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT
  return Math.min(MAX_LIMIT, parsed)
}

// Writes are restricted to the in-process MCP tool, which calls
// `createAnnouncement` directly. Exposing a public POST here would let
// any caller forge attribution by supplying any employeeId, since the
// route can't authenticate the caller against the supplied id.
export const announcementsRoute = new Hono()
  // Reverse-chronological list. `limit` is a soft cap to keep cold
  // payloads small; the view never paginates further today.
  .get('/announcements', async (c) => {
    const limit = clampLimit(c.req.query('limit'))
    const db = getDb()
    const rows = await db
      .select()
      .from(announcements)
      .orderBy(desc(announcements.postedAt))
      .limit(limit)
    return c.json(rows.map(serialize))
  })

  // Live stream. Replays the most recent N rows on connect so a cold
  // open mirrors GET /announcements, then keeps the connection open
  // for `announcement.posted` fan-outs from the bus. The renderer
  // dedupes by id, so overlap with a concurrent GET is safe.
  .get('/announcements/stream', (c) => {
    return streamSSE(c, async (stream) => {
      const queue: Announcement[] = []
      let live = false
      const unsubscribe = getAnnouncementBus().subscribe((row) => {
        if (live) {
          void stream.writeSSE({
            id: row.id,
            event: 'announcement.posted',
            data: JSON.stringify(serialize(row)),
          })
        } else {
          queue.push(row)
        }
      })

      try {
        // Replay the recent rows from disk FIRST. Closes the
        // GET-vs-EventSource race window: a `post_announcement` that
        // lands after the client's GET response leaves the server but
        // before the SSE subscription is established still reaches
        // the client here.
        const db = getDb()
        const recent = await db
          .select()
          .from(announcements)
          .orderBy(desc(announcements.postedAt))
          .limit(STREAM_REPLAY_LIMIT)
        // Send oldest-first so the client's list ordering matches the
        // GET response when the stream events arrive after.
        for (let i = recent.length - 1; i >= 0; i -= 1) {
          const row = recent[i]
          if (!row) continue
          await stream.writeSSE({
            id: row.id,
            event: 'announcement.posted',
            data: JSON.stringify(serialize(row)),
          })
        }
        // Drain anything the bus pushed while the replay was in
        // flight (then flip to live for direct fan-out).
        live = true
        for (const row of queue) {
          await stream.writeSSE({
            id: row.id,
            event: 'announcement.posted',
            data: JSON.stringify(serialize(row)),
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
