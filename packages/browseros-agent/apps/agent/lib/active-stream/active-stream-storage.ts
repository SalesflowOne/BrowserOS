import { storage } from '@wxt-dev/storage'
import type { ChatStatus, UIMessage } from 'ai'

export interface ActiveStreamState {
  conversationId: string
  messages: UIMessage[]
  status: ChatStatus
  lastUpdated: number
  followerTabIds: number[]
}

/**
 * Registry of active conversation IDs. Each conversation's state is stored
 * under its own key (`session:stream:<id>`) to avoid read-modify-write races
 * when multiple agents run in parallel.
 */
export const activeStreamIdsStorage = storage.defineItem<string[]>(
  'session:active-stream-ids',
  { fallback: [] },
)

function streamKey(conversationId: string) {
  return `session:stream:${conversationId}` as const
}

/** Write a conversation's stream state to its own storage key. */
export async function setActiveStream(state: ActiveStreamState): Promise<void> {
  // Register ID first so the watcher's getAllActiveStreams() can find it
  const ids = await activeStreamIdsStorage.getValue()
  if (!ids.includes(state.conversationId)) {
    await activeStreamIdsStorage.setValue([...ids, state.conversationId])
  }

  const key = streamKey(state.conversationId)
  await chrome.storage.session.set({ [key]: state }).catch(() => {})
}

/** Remove a conversation's stream state. */
export async function clearActiveStream(conversationId: string): Promise<void> {
  const key = streamKey(conversationId)
  await chrome.storage.session.remove(key).catch(() => {})

  const ids = await activeStreamIdsStorage.getValue()
  await activeStreamIdsStorage.setValue(
    ids.filter((id) => id !== conversationId),
  )
}

/** Read all active streams. */
export async function getAllActiveStreams(): Promise<ActiveStreamState[]> {
  const ids = await activeStreamIdsStorage.getValue()
  if (ids.length === 0) return []
  const keys = ids.map(streamKey)
  const result = await chrome.storage.session.get(keys)
  return keys
    .map((k) => result[k] as ActiveStreamState | undefined)
    .filter((s): s is ActiveStreamState => !!s)
}

/** Find which active stream (if any) includes the given tabId as a follower. */
export async function findStreamForTab(
  tabId: number,
): Promise<ActiveStreamState | undefined> {
  const streams = await getAllActiveStreams()
  return streams.find((s) => s.followerTabIds.includes(tabId))
}

/**
 * Watch for changes to any active stream.
 * Calls the handler with all current active streams whenever any stream key changes.
 */
export function watchActiveStreams(
  handler: (streams: ActiveStreamState[]) => void,
): () => void {
  const listener = (changes: Record<string, chrome.storage.StorageChange>) => {
    const hasStreamChange = Object.keys(changes).some(
      (k) => k.startsWith('session:stream:') || k === 'active-stream-ids',
    )
    if (hasStreamChange) {
      getAllActiveStreams()
        .then(handler)
        .catch(() => {})
    }
  }
  chrome.storage.session.onChanged.addListener(listener)
  return () => chrome.storage.session.onChanged.removeListener(listener)
}

/**
 * Extract all unique tabIds from tool output metadata in messages.
 * The server attaches metadata.tabId to every tool that operates on or creates a page.
 */
export function extractToolTabIds(messages: UIMessage[]): number[] {
  const tabIds = new Set<number>()
  for (const message of messages) {
    if (!message.parts) continue
    for (const part of message.parts) {
      const typedPart = part as { type?: string; output?: unknown }
      if (!typedPart.type?.startsWith('tool-')) continue

      const output = typedPart.output as
        | { metadata?: { tabId?: number } }
        | undefined
      if (output?.metadata?.tabId) {
        tabIds.add(output.metadata.tabId)
      }
    }
  }
  return [...tabIds]
}
