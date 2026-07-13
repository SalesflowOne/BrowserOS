import { describe, expect, it } from 'bun:test'
import type { UIMessage } from 'ai'
import { planConversationSave } from './conversation-save'
import type { Conversation } from './conversationStorage'

describe('planConversationSave', () => {
  it('detects a part appended to the last message without a message-count change', () => {
    const current = [
      conversation('active', [userMessage(), assistantMessage()]),
    ]
    const messages = structuredClone(current[0].messages)
    messages[1].parts.push({ type: 'text', text: 'Done' })

    const plan = planConversationSave(current, 'active', messages, 200)

    expect(plan?.conversations[0]).toEqual({
      ...current[0],
      messages,
      lastMessagedAt: 200,
    })
    expect(plan?.removedConversationIds).toEqual([])
  })

  it('detects text growth in the terminal part', () => {
    const current = [conversation('active', [assistantMessage('Partial')])]
    const messages = [assistantMessage('Partial response')]

    const plan = planConversationSave(current, 'active', messages, 200)

    expect(plan?.conversations[0].messages).toEqual(messages)
  })

  it('detects equal-length changes inside terminal text', () => {
    const edge = 'x'.repeat(16)
    const current = [
      conversation('active', [assistantMessage(`${edge}old${edge}`)]),
    ]
    const messages = [assistantMessage(`${edge}new${edge}`)]

    const plan = planConversationSave(current, 'active', messages, 200)

    expect(plan?.conversations[0].messages).toEqual(messages)
  })

  it('returns no update for an identical cloned snapshot', () => {
    const current = [
      conversation('active', [userMessage(), assistantMessage()]),
    ]

    const plan = planConversationSave(
      current,
      'active',
      structuredClone(current[0].messages),
      200,
    )

    expect(plan).toBeNull()
  })

  it('prepends a new conversation', () => {
    const current = [conversation('older', [userMessage('Earlier')], 100)]
    const messages = [userMessage('New')]

    const plan = planConversationSave(current, 'new', messages, 200)

    expect(plan?.conversations).toEqual([
      { id: 'new', messages, lastMessagedAt: 200 },
      current[0],
    ])
    expect(plan?.removedConversationIds).toEqual([])
  })

  it('caps new saves at 50 conversations and returns every trimmed id', () => {
    const current = Array.from({ length: 52 }, (_, index) =>
      conversation(`conversation-${index}`, [userMessage(String(index))]),
    )

    const plan = planConversationSave(
      current,
      'new',
      [userMessage('Newest')],
      200,
    )

    expect(plan?.conversations).toHaveLength(50)
    expect(plan?.conversations[0].id).toBe('new')
    expect(plan?.removedConversationIds).toEqual([
      'conversation-49',
      'conversation-50',
      'conversation-51',
    ])
  })
})

function conversation(
  id: string,
  messages: UIMessage[],
  lastMessagedAt = 100,
): Conversation {
  return { id, messages, lastMessagedAt }
}

function userMessage(text = 'Hello'): UIMessage {
  return {
    id: `user-${text}`,
    role: 'user',
    parts: [{ type: 'text', text }],
  }
}

function assistantMessage(text = 'Working'): UIMessage {
  return {
    id: 'assistant-active',
    role: 'assistant',
    parts: [{ type: 'text', text, state: 'streaming' }],
  }
}
