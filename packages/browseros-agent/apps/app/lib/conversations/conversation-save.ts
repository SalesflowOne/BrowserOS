import type { UIMessage } from 'ai'
import { isEqual } from 'es-toolkit'
import type { Conversation } from './conversationStorage'

const MAX_CONVERSATIONS = 50

/** Builds the next bounded conversation list, or returns null when the append-only chat snapshot has not advanced. */
export function planConversationSave(
  current: Conversation[],
  id: string,
  messages: UIMessage[],
  lastMessagedAt = Date.now(),
): {
  conversations: Conversation[]
  removedConversationIds: string[]
} | null {
  const existingIndex = current.findIndex(
    (conversation) => conversation.id === id,
  )

  if (existingIndex >= 0) {
    const existing = current[existingIndex]
    if (!haveMessagesChanged(existing.messages, messages)) return null

    const conversations = [...current]
    conversations[existingIndex] = {
      ...existing,
      messages,
      lastMessagedAt,
    }

    return { conversations, removedConversationIds: [] }
  }

  const nextConversations = [
    { id, messages, lastMessagedAt },
    ...current,
  ].slice(0, MAX_CONVERSATIONS)

  return {
    conversations: nextConversations,
    removedConversationIds: current
      .slice(MAX_CONVERSATIONS - 1)
      .map((conversation) => conversation.id),
  }
}

function haveMessagesChanged(previous: UIMessage[], next: UIMessage[]) {
  if (previous.length !== next.length) return true

  const previousMessage = previous.at(-1)
  const nextMessage = next.at(-1)
  if (!previousMessage || !nextMessage) return false

  if (
    previousMessage.id !== nextMessage.id ||
    previousMessage.role !== nextMessage.role ||
    previousMessage.parts.length !== nextMessage.parts.length
  ) {
    return true
  }

  return (
    !isEqual(previousMessage.metadata, nextMessage.metadata) ||
    !isEqual(previousMessage.parts.at(-1), nextMessage.parts.at(-1))
  )
}
