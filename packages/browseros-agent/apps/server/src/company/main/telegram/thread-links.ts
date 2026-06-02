import { eq, inArray } from 'drizzle-orm'
import { telegramChats } from '../../db/schema/telegram_chats.sql.js'
import { telegramConnections } from '../../db/schema/telegram_connections.sql.js'
import type { Thread } from '../../db/schema/threads.sql.js'
import { getDb } from '../db-singleton.js'

// Derived linkage between a thread and the Telegram bot that can reach
// it. Pure read concern — never written back. Source of truth is the
// (telegram_chats, telegram_connections) join. The renderer uses it
// purely to show a paperplane glyph and a chat-header chip; conversation
// sync itself is handled by the event bus and needs no client wiring.
export interface ThreadTelegramLink {
  connectionId: string
  botName: string
  botUsername: string | null
}

// One round-trip resolves links for an arbitrary set of thread ids. The
// /employees/with-recent-threads handler hands every thread in the rail
// through here; the /threads/:id handler passes just one. Either way the
// renderer never has to do an N+1 fan-out.
export async function loadTelegramLinks(
  threadIds: string[],
): Promise<Map<string, ThreadTelegramLink>> {
  if (threadIds.length === 0) return new Map()
  const rows = await getDb()
    .select({
      threadId: telegramChats.threadId,
      connectionId: telegramConnections.id,
      botName: telegramConnections.name,
      botUsername: telegramConnections.botUsername,
    })
    .from(telegramChats)
    .innerJoin(
      telegramConnections,
      eq(telegramConnections.id, telegramChats.connectionId),
    )
    .where(inArray(telegramChats.threadId, threadIds))
  const map = new Map<string, ThreadTelegramLink>()
  for (const row of rows) {
    map.set(row.threadId, {
      connectionId: row.connectionId,
      botName: row.botName,
      botUsername: row.botUsername,
    })
  }
  return map
}

export function serializeThreadWithLink(
  row: Thread,
  telegramLink: ThreadTelegramLink | null,
) {
  return {
    ...row,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
    telegramLink,
  }
}

// Groups non-archived threads by their employeeId, preserving the
// caller's input ordering inside each bucket. Lives next to
// loadTelegramLinks so the rail's combined "list employees with their
// recent threads + their Telegram links" query stays one tiny module.
export function bucketThreadsByEmployee(
  threadRows: Thread[],
): Map<string, Thread[]> {
  const byEmployee = new Map<string, Thread[]>()
  for (const t of threadRows) {
    if (t.archivedAt) continue
    const bucket = byEmployee.get(t.employeeId) ?? []
    bucket.push(t)
    byEmployee.set(t.employeeId, bucket)
  }
  return byEmployee
}
