import type { UIMessage } from 'ai'
import type { Conversation } from './conversationStorage'

const MAX_CONVERSATIONS = 50
const STRING_SAMPLE_SIZE = 16
const MAX_FINGERPRINT_DEPTH = 3

interface ConversationSavePlan {
  conversations: Conversation[]
  removedConversationIds: string[]
}

/** Builds the next bounded conversation list, or returns null when the append-only chat snapshot has not advanced. */
export function planConversationSave(
  current: Conversation[],
  id: string,
  messages: UIMessage[],
  lastMessagedAt = Date.now(),
): ConversationSavePlan | null {
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
    partFingerprint(previousMessage.parts.at(-1)) !==
    partFingerprint(nextMessage.parts.at(-1))
  )
}

function partFingerprint(part: UIMessage['parts'][number] | undefined) {
  if (!part) return ''
  const fields = part as unknown as Record<string, unknown>
  const content =
    fields.text ??
    fields.output ??
    fields.data ??
    fields.errorText ??
    fields.url ??
    fields.input

  return [
    part.type,
    fields.state,
    fields.toolCallId,
    fields.id,
    fields.sourceId,
    contentFingerprint(content),
  ].join(':')
}

function contentFingerprint(value: unknown, depth = 0): string {
  if (typeof value === 'string') {
    return `${value.length}:${value.slice(0, STRING_SAMPLE_SIZE)}:${value.slice(-STRING_SAMPLE_SIZE)}`
  }
  if (value === null || typeof value !== 'object') return String(value)
  if (depth >= MAX_FINGERPRINT_DEPTH)
    return Object.prototype.toString.call(value)
  if (Array.isArray(value)) {
    return `${value.length}:${contentFingerprint(value.at(-1), depth + 1)}`
  }

  const record = value as Record<string, unknown>
  const keys = Object.keys(record).sort()
  const firstKey = keys[0]
  const lastKey = keys.at(-1)
  return `${keys.length}:${firstKey}:${contentFingerprint(record[firstKey], depth + 1)}:${lastKey}:${contentFingerprint(record[lastKey ?? ''], depth + 1)}`
}
