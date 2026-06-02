import { eq } from 'drizzle-orm'
import { DEFAULT_THREAD_TITLE, threads } from '../../db/schema/threads.sql.js'
import type { DB } from '../../db/types.js'
import { EventSink } from './event-sink.js'

const MAX_TITLE_LENGTH = 60
const MAX_WORDS = 7

/**
 * Backfill a thread's title from the first user message if the agent
 * didn't call `browserclaw/set_thread_title` itself. Runs after every
 * successful turn; the string-check guard (and the db.transaction)
 * makes it a no-op once a non-default title is in place — so the
 * agent's set_thread_title call wins when the agent obeys, and this
 * fallback covers the case where it doesn't.
 *
 * Title generation is rule-based (first N words, trim punctuation).
 * An LLM-based derivation would be nicer but requires an extra
 * provider with its own auth; not worth the additional surface for
 * a sidebar label.
 */
export async function maybeAutoTitle(
  db: DB,
  threadId: string,
  firstUserMessage: string,
): Promise<void> {
  const derived = deriveTitle(firstUserMessage)
  if (!derived) return

  const { committed, title } = await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ title: threads.title })
      .from(threads)
      .where(eq(threads.id, threadId))
      .limit(1)
    if (!row) return { committed: false, title: null as string | null }
    if (row.title !== DEFAULT_THREAD_TITLE) {
      return { committed: false, title: row.title }
    }
    await tx
      .update(threads)
      .set({ title: derived, updatedAt: new Date() })
      .where(eq(threads.id, threadId))
    return { committed: true, title: derived }
  })

  if (!committed) return
  const sink = new EventSink(db, threadId)
  await sink.emit({
    type: 'thread.title_changed',
    payload: { threadId, title: title as string },
  })
}

/**
 * Take the first ~6 meaningful words of the user's first message,
 * cap at 60 chars on a word boundary, and trim trailing punctuation.
 * Returns an empty string if the input was effectively empty (e.g.
 * the user sent only whitespace) — the caller skips the update in
 * that case.
 */
export function deriveTitle(message: string): string {
  const collapsed = message.replace(/\s+/g, ' ').trim()
  if (!collapsed) return ''
  const words = collapsed.split(' ').slice(0, MAX_WORDS).join(' ')
  let title = words.slice(0, MAX_TITLE_LENGTH).trim()
  // If the slice fell mid-word, walk back to the last word boundary.
  if (title.length === MAX_TITLE_LENGTH && words.length > MAX_TITLE_LENGTH) {
    const lastSpace = title.lastIndexOf(' ')
    if (lastSpace > 0) title = title.slice(0, lastSpace)
  }
  title = title.replace(/[\s.,!?;:]+$/, '')
  // Sentence-case — capitalise the first letter so the rail label
  // reads cleanly even when the user typed all-lowercase.
  if (title.length > 0) {
    title = title[0].toUpperCase() + title.slice(1)
  }
  return title
}
