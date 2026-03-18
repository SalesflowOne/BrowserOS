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
 * Single storage item holding the active stream state.
 * Uses local storage for reliable cross-context access (background + sidepanel).
 * Keyed by conversationId inside the map for parallel agent support.
 */
export type ActiveStreamsMap = Record<string, ActiveStreamState>

export const activeStreamsStorage = storage.defineItem<ActiveStreamsMap>(
  'local:active-streams',
  { fallback: {} },
)

/** Write a conversation's stream state. */
export async function setActiveStream(state: ActiveStreamState): Promise<void> {
  const map = await activeStreamsStorage.getValue()
  map[state.conversationId] = state
  await activeStreamsStorage.setValue(map)
}

/** Remove a conversation's stream state. */
export async function clearActiveStream(conversationId: string): Promise<void> {
  const map = await activeStreamsStorage.getValue()
  delete map[conversationId]
  await activeStreamsStorage.setValue(map)
}

/** Read all active streams. */
export async function getAllActiveStreams(): Promise<ActiveStreamState[]> {
  const map = await activeStreamsStorage.getValue()
  return Object.values(map)
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
