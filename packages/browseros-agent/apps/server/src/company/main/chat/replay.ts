import type { ModelMessage } from 'ai'
import { asc, eq } from 'drizzle-orm'
import { events } from '../../db/schema/events.sql.js'
import type { DB } from '../../db/types.js'
import type { TextEndPayload, TurnStartPayload } from './events.types.js'

/**
 * Project the persisted `events` rows for a thread into an AI SDK
 * `ModelMessage[]` — used by `ChatSession.send` when handing the
 * conversation off to a freshly-built provider (different agent or
 * workspace). The receiving agent has no native ACP session memory
 * for this thread, so we replay user + assistant text from the
 * events log.
 *
 * Reasoning blocks and tool calls/results are **deliberately dropped**.
 * They're agent-specific and not portable across adapters; the new
 * agent should respond to the user/assistant dialogue, not try to
 * continue a tool call only the previous agent could make.
 *
 * `excludeRequestId` is the request id of the *current* turn — its
 * `turn.start` row has already been emitted at the time this helper
 * is called (so `rebuildMessagesFromEvents` can run before
 * `streamText`), but the current user message should not be in the
 * replay payload; it goes in as a separate `ModelMessage` at the
 * end of the message array.
 */
function parsePayload(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function isExcluded(
  requestId: string | undefined,
  excludeRequestId: string | undefined,
): boolean {
  return Boolean(excludeRequestId && requestId === excludeRequestId)
}

function projectTurnStart(
  p: TurnStartPayload,
  excludeRequestId: string | undefined,
): ModelMessage | null {
  if (isExcluded(p.requestId, excludeRequestId)) return null
  if (!p.userMessage) return null
  return { role: 'user', content: p.userMessage }
}

function projectTextEnd(
  p: TextEndPayload,
  excludeRequestId: string | undefined,
): ModelMessage | null {
  if (p.reasoning) return null
  if (isExcluded(p.requestId, excludeRequestId)) return null
  if (!p.text) return null
  return { role: 'assistant', content: p.text }
}

function projectRow(
  kind: string,
  payload: unknown,
  excludeRequestId: string | undefined,
): ModelMessage | null {
  if (!payload) return null
  if (kind === 'turn.start') {
    return projectTurnStart(payload as TurnStartPayload, excludeRequestId)
  }
  if (kind === 'text.end') {
    return projectTextEnd(payload as TextEndPayload, excludeRequestId)
  }
  return null
}

export async function rebuildMessagesFromEvents(
  db: DB,
  threadId: string,
  excludeRequestId?: string,
): Promise<ModelMessage[]> {
  const rows = await db
    .select({ kind: events.kind, payload: events.payload })
    .from(events)
    .where(eq(events.threadId, threadId))
    .orderBy(asc(events.seq))

  const messages: ModelMessage[] = []
  for (const row of rows) {
    const payload = parsePayload(row.payload)
    if (!payload) continue
    const message = projectRow(row.kind, payload, excludeRequestId)
    if (message) messages.push(message)
  }
  return messages
}
