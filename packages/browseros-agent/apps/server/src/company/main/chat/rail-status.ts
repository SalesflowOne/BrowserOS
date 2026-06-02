// Per-thread + per-employee status used by the rail. Derived at the
// rail's list-endpoint read time; not persisted on employees because
// the value flips on every text.delta during a live turn and that's
// the hot path of the chat stream.
//
// Precedence (top-down — matches herbie's "streaming wins over
// unread" ordering in src/mainview/components/layout/ConversationRow.tsx):
//
//   working   — thread.status='streaming' AND ≥1 text/tool event after
//               the latest turn.start (the agent is actively producing
//               output).
//   pending   — thread.status='streaming' AND no qualifying event since
//               the latest turn.start (the request fired, the model
//               hasn't streamed anything yet).
//   attention — thread.status idle/completed/error AND ≥1 event with
//               ts > lastSeenAt (lastSeenAt=null → everything's
//               unread — matches herbie's convention).
//   idle      — none of the above.
//
// Employee-level status aggregates across the employee's non-archived
// threads by max precedence: one streaming thread + three unread idle
// threads = "working" at the avatar.

import { and, eq, gt, inArray, max } from 'drizzle-orm'
import { events } from '../../db/schema/events.sql.js'
import { threads } from '../../db/schema/threads.sql.js'
import type { DB } from '../../db/types.js'

export type RailStatus = 'working' | 'pending' | 'attention' | 'idle'

const PRIORITY: Record<RailStatus, number> = {
  working: 3,
  pending: 2,
  attention: 1,
  idle: 0,
}

export interface ThreadStatusSnapshot {
  threadId: string
  status: RailStatus
  unread: boolean
  pending: boolean
}

// The three event kinds that mean "the agent is actively producing
// output." text.end / turn.end are not in the set — they're terminal
// markers, not "look, output is happening." Matching this list against
// the stream events table is what distinguishes working from pending.
const OUTPUT_KINDS = [
  'text.delta',
  'tool.call.proposed',
  'tool.result',
] as const

export async function computeThreadStatuses(
  db: DB,
  threadIds: string[],
): Promise<Map<string, ThreadStatusSnapshot>> {
  if (threadIds.length === 0) return new Map()

  const [threadRows, latestTurnStarts, latestEventTimes] = await Promise.all([
    db
      .select({
        id: threads.id,
        status: threads.status,
        lastSeenAt: threads.lastSeenAt,
      })
      .from(threads)
      .where(inArray(threads.id, threadIds)),
    db
      .select({
        threadId: events.threadId,
        maxSeq: max(events.seq).as('maxSeq'),
      })
      .from(events)
      .where(
        and(inArray(events.threadId, threadIds), eq(events.kind, 'turn.start')),
      )
      .groupBy(events.threadId),
    db
      .select({
        threadId: events.threadId,
        maxTs: max(events.ts).as('maxTs'),
      })
      .from(events)
      .where(inArray(events.threadId, threadIds))
      .groupBy(events.threadId),
  ])

  const turnStartSeqByThread = new Map<string, number>(
    latestTurnStarts.map((r) => [r.threadId, Number(r.maxSeq ?? -1)]),
  )
  const latestTsByThread = new Map<string, number>(
    latestEventTimes.map((r) => {
      // max() over a timestamp_ms column comes back as a Date when the
      // driver inflates it, or as a number/string otherwise; normalise
      // both shapes to a numeric ms epoch so the downstream unread
      // comparison is a plain `>`.
      const raw = r.maxTs as unknown
      const ts =
        raw instanceof Date
          ? raw.getTime()
          : typeof raw === 'number'
            ? raw
            : Number(raw ?? 0)
      return [r.threadId, ts]
    }),
  )

  // "Has any output-kind event landed after the latest turn.start for
  // this thread?" One LIMIT-1 probe per streaming thread is plenty.
  // Skipped entirely for threads not currently streaming or with no
  // turn.start on record — the answer doesn't change their rail status.
  const probeNeeded = threadRows.filter(
    (r) =>
      r.status === 'streaming' && (turnStartSeqByThread.get(r.id) ?? -1) >= 0,
  )
  const probes = await Promise.all(
    probeNeeded.map(async (r) => {
      const startSeq = turnStartSeqByThread.get(r.id) ?? -1
      const hits = await db
        .select({ id: events.id })
        .from(events)
        .where(
          and(
            eq(events.threadId, r.id),
            inArray(events.kind, [...OUTPUT_KINDS]),
            gt(events.seq, startSeq),
          ),
        )
        .limit(1)
      return [r.id, hits.length > 0] as const
    }),
  )
  const producedOutputSinceStart = new Map(probes)

  const out = new Map<string, ThreadStatusSnapshot>()
  for (const row of threadRows) {
    const streaming = row.status === 'streaming'
    const lastEventTs = latestTsByThread.get(row.id) ?? 0
    const lastSeen = row.lastSeenAt ? row.lastSeenAt.getTime() : 0
    const unread = lastEventTs > lastSeen
    const produced = producedOutputSinceStart.get(row.id) ?? false
    const pending = streaming && !produced

    let status: RailStatus
    if (streaming && produced) status = 'working'
    else if (streaming) status = 'pending'
    else if (unread) status = 'attention'
    else status = 'idle'

    out.set(row.id, { threadId: row.id, status, unread, pending })
  }
  return out
}

export function aggregateEmployeeRailStatus(
  snapshots: ThreadStatusSnapshot[],
): RailStatus {
  if (snapshots.length === 0) return 'idle'
  let best: RailStatus = 'idle'
  for (const s of snapshots) {
    if (PRIORITY[s.status] > PRIORITY[best]) best = s.status
  }
  return best
}
