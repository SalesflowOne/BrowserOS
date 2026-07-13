import type { UIMessage } from 'ai'
import { useEffect, useState } from 'react'
import { useSessionInfo } from '../auth/sessionStorage'
import { removeConversationExecutionHistory } from '../execution-history/storage'
import { planConversationSave } from './conversation-save'
import { type Conversation, conversationStorage } from './conversationStorage'
import { uploadConversationsToGraphql } from './uploadConversationsToGraphql'

export function useConversations() {
  const [conversations, setConversations] = useState<Conversation[]>([])

  const { sessionInfo } = useSessionInfo()

  useEffect(() => {
    // user is logged in, could sync conversations from server here
    if (sessionInfo.user?.id && conversations.length > 0) {
      uploadConversationsToGraphql(conversations)
    }
  }, [sessionInfo.user?.id, conversations])

  useEffect(() => {
    conversationStorage.getValue().then(setConversations)
    const unwatch = conversationStorage.watch((newValue) => {
      setConversations(newValue ?? [])
    })
    return unwatch
  }, [])

  const removeConversation = async (id: string) => {
    const current = (await conversationStorage.getValue()) ?? []
    await conversationStorage.setValue(current.filter((c) => c.id !== id))
    await removeConversationExecutionHistory(id)
  }

  const saveConversation = async (id: string, messages: UIMessage[]) => {
    const current = (await conversationStorage.getValue()) ?? []
    const plan = planConversationSave(current, id, messages)
    if (!plan) return

    await conversationStorage.setValue(plan.conversations)
    await Promise.all(
      plan.removedConversationIds.map(removeConversationExecutionHistory),
    )
  }

  const getConversation = (id: string) => {
    return conversations.find((c) => c.id === id)
  }

  return {
    conversations,
    removeConversation,
    saveConversation,
    getConversation,
  }
}
