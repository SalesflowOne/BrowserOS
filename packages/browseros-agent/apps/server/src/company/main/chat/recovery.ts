import { and, desc, eq, inArray } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { events } from '../../db/schema/events.sql.js'
import { threads } from '../../db/schema/threads.sql.js'
import type { DB } from '../../db/types.js'

const TERMINAL_KINDS = new Set(['turn.end', 'turn.cancel', 'error'])

// On boot: any thread left mid-turn from a previous process gets a
// synthetic turn.cancel + flips to idle, so the renderer doesn't see
// a phantom spinner forever.
export async function recoverInterruptedTurns(db: DB): Promise<void> {
  const stuck = await db
    .select()
    .from(threads)
    .where(inArray(threads.status, ['streaming', 'awaiting_approval']))

  for (const thread of stuck) {
    const latest = await db
      .select()
      .from(events)
      .where(eq(events.threadId, thread.id))
      .orderBy(desc(events.seq))
      .limit(1)
    const top = latest[0]
    if (top && TERMINAL_KINDS.has(top.kind)) {
      // Status was stale but the event log is consistent — just heal status.
      await db
        .update(threads)
        .set({ status: 'idle', updatedAt: new Date() })
        .where(
          and(eq(threads.id, thread.id), eq(threads.status, thread.status)),
        )
      continue
    }
    const nextSeq = (top?.seq ?? -1) + 1
    const requestId =
      top &&
      (top.kind === 'turn.start' ||
        top.kind === 'text.delta' ||
        top.kind === 'tool.call.proposed')
        ? safeRequestId(top.payload)
        : nanoid()
    const now = new Date()
    await db.transaction(async (tx) => {
      await tx.insert(events).values({
        id: nanoid(),
        threadId: thread.id,
        seq: nextSeq,
        kind: 'turn.cancel',
        payload: JSON.stringify({ requestId, reason: 'boot-recovery' }),
        ts: now,
      })
      await tx
        .update(threads)
        .set({ status: 'idle', updatedAt: now })
        .where(eq(threads.id, thread.id))
    })
  }
}

function safeRequestId(payload: string): string {
  try {
    const parsed = JSON.parse(payload) as { requestId?: unknown }
    return typeof parsed.requestId === 'string' ? parsed.requestId : nanoid()
  } catch {
    return nanoid()
  }
}
