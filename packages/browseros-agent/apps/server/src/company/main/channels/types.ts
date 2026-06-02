// Public types for the channels surface. The transcript itself lives
// in the `messages` table (surface='channel'); types here cover the
// SSE event protocol and the in-process per-employee queues.

import type { Channel } from '../../db/schema/channels.sql.js'
import type { Employee } from '../../db/schema/employees.sql.js'
import type { Message } from '../../db/schema/messages.sql.js'

export const USER_PARTICIPANT_ID = 'user'

/** A transcript row reshaped for the renderer SSE payload. A row in
 *  `'streaming'` state is mid-turn (renderer paints a typewriter
 *  cursor); `'complete'` is finalised; `'error'` is partial because
 *  the turn errored mid-stream. */
export interface TranscriptEntry {
  id: string
  ts: number
  fromParticipantId: string
  toParticipantId: string | null
  kind: Message['kind']
  body: string
  status: Message['status']
}

export interface ChannelMemberLite {
  id: string
  name: string
  role: string
  monogram: string
  tint: Employee['tint']
}

export interface ChannelSnapshot {
  id: string
  name: string
  topic: string | null
  leadEmployeeId: string
  createdByParticipantId: string
  memberIds: string[]
  archivedAt: number | null
  createdAt: number
  updatedAt: number
}

export interface ChannelListItem extends ChannelSnapshot {
  memberCount: number
  // ms-epoch of the latest message in the channel, or null when empty.
  lastActivityAt: number | null
}

/** SSE event union. The renderer's reducer matches on `kind` and
 *  applies the patch. */
export type ChannelEvent =
  | {
      kind: 'transcript.append'
      seq: number
      ts: number
      entry: TranscriptEntry
    }
  | {
      kind: 'text.delta'
      seq: number
      ts: number
      employeeId: string
      blockId: string
      text: string
    }
  | {
      kind: 'text.end'
      seq: number
      ts: number
      employeeId: string
      blockId: string
    }
  | {
      kind: 'turn.start'
      seq: number
      ts: number
      employeeId: string
    }
  | {
      kind: 'turn.end'
      seq: number
      ts: number
      employeeId: string
      status: 'completed' | 'cancelled' | 'error'
      message?: string
    }
  | {
      // Latest pageId touched by a browseros tool in this channel —
      // drives the channel pane's `pageId` since channel transcript
      // rows don't carry tool parts.
      kind: 'meta.active-page-id'
      seq: number
      ts: number
      pageId: number
    }

export const ALL_CHANNEL_EVENT_KINDS: ChannelEvent['kind'][] = [
  'transcript.append',
  'text.delta',
  'text.end',
  'turn.start',
  'turn.end',
  'meta.active-page-id',
]

/** One pending invocation for a specific employee. The employee's
 *  queue is `QueueItem[]` keyed by recipient. `fromEmployeeId` is the
 *  sender — either `'user'` for founder posts, or another employee id
 *  for `messageEmployee` calls. No routing-target field: replies are
 *  explicit via `messageEmployee('user' | empId, body)`. */
export interface QueueItem {
  fromEmployeeId: string
  body: string
  ts: number
}

export function messageRowToTranscriptEntry(row: Message): TranscriptEntry {
  return {
    id: row.id,
    ts: row.createdAt.getTime(),
    fromParticipantId: row.authorId,
    toParticipantId: row.toParticipantId,
    kind: row.kind,
    body: row.body ?? '',
    status: row.status,
  }
}

export interface ChannelWithMembers {
  channel: Channel
  memberIds: string[]
}
