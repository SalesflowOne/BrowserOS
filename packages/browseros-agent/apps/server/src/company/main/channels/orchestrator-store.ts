// Read helpers used by the channel orchestrator. Pulled out of the
// orchestrator class so the turn loop in `orchestrator.ts` stays
// focused on state-machine logic — these are stateless DB reads that
// take a `getDb()` handle and return rows.
//
// All helpers call `getDb()` lazily so they're test-friendly: tests
// that set the DB singleton with an in-memory libsql instance get
// the same code paths as production.

import { and, asc, eq, gt, inArray } from 'drizzle-orm'
import { channelMemberSessions } from '../../db/schema/channel_member_sessions.sql.js'
import { channelMembers } from '../../db/schema/channel_members.sql.js'
import { type Channel, channels } from '../../db/schema/channels.sql.js'
import { type Employee, employees } from '../../db/schema/employees.sql.js'
import { type Message, messages } from '../../db/schema/messages.sql.js'
import { getDb } from '../db-singleton.js'

/** Channel-side per-(channel, employee) cursors loaded from
 *  `channel_member_sessions`. Returns sane defaults for a fresh
 *  session (employee has never spoken in this channel before). */
export interface SessionCursors {
  lastSeenAt: number
  soulMtimeSeen: number
}

export async function loadChannel(channelId: string): Promise<Channel | null> {
  const db = getDb()
  const rows = await db
    .select()
    .from(channels)
    .where(eq(channels.id, channelId))
    .limit(1)
  return rows[0] ?? null
}

export async function loadMemberIds(channelId: string): Promise<string[]> {
  const db = getDb()
  const rows = await db
    .select({ employeeId: channelMembers.employeeId })
    .from(channelMembers)
    .where(eq(channelMembers.channelId, channelId))
  return rows.map((r) => r.employeeId)
}

export async function loadMemberEmployees(
  channelId: string,
): Promise<Employee[]> {
  const memberIds = await loadMemberIds(channelId)
  if (memberIds.length === 0) return []
  const db = getDb()
  return db.select().from(employees).where(inArray(employees.id, memberIds))
}

export async function loadEmployee(
  employeeId: string,
): Promise<Employee | null> {
  const db = getDb()
  const rows = await db
    .select()
    .from(employees)
    .where(eq(employees.id, employeeId))
    .limit(1)
  return rows[0] ?? null
}

/** Read the per-(channel, employee) session cursors, creating the row
 *  with defaults if it doesn't exist yet. Idempotent. */
export async function loadOrCreateSession(
  channelId: string,
  employeeId: string,
): Promise<SessionCursors> {
  const db = getDb()
  const rows = await db
    .select()
    .from(channelMemberSessions)
    .where(
      and(
        eq(channelMemberSessions.channelId, channelId),
        eq(channelMemberSessions.employeeId, employeeId),
      ),
    )
    .limit(1)
  const existing = rows[0]
  if (existing) {
    return {
      lastSeenAt: existing.lastSeenAt,
      soulMtimeSeen: existing.soulMtimeSeen,
    }
  }
  const now = new Date()
  await db.insert(channelMemberSessions).values({
    channelId,
    employeeId,
    lastSeenAt: 0,
    soulMtimeSeen: 0,
    updatedAt: now,
  })
  return { lastSeenAt: 0, soulMtimeSeen: 0 }
}

/** Update session cursors after a successful turn. Pass `lastSeenAt`
 *  computed from the delta actually fed to the model — never query
 *  `MAX(createdAt)` here, because rows that landed during the turn
 *  (after `loadDelta` ran) would get skipped in the next delta. */
export async function advanceSessionCursors(
  channelId: string,
  employeeId: string,
  lastSeenAt: number,
  soulMtime: number,
): Promise<void> {
  const db = getDb()
  await db
    .update(channelMemberSessions)
    .set({
      lastSeenAt,
      soulMtimeSeen: soulMtime,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(channelMemberSessions.channelId, channelId),
        eq(channelMemberSessions.employeeId, employeeId),
      ),
    )
}

/** Channel transcript messages strictly after the given timestamp,
 *  in ascending order. Used to build the delta block fed into the
 *  agent's per-turn prompt. */
export async function loadDelta(
  channelId: string,
  lastSeenAt: number,
): Promise<Message[]> {
  const db = getDb()
  return db
    .select()
    .from(messages)
    .where(
      and(
        eq(messages.surface, 'channel'),
        eq(messages.surfaceId, channelId),
        gt(messages.createdAt, new Date(lastSeenAt)),
      ),
    )
    .orderBy(asc(messages.createdAt))
}
