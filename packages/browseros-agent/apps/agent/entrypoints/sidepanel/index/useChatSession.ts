import { useChat } from '@ai-sdk/react'
import { type ChatStatus, DefaultChatTransport, type UIMessage } from 'ai'
import { compact } from 'es-toolkit/array'
import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import useDeepCompareEffect from 'use-deep-compare-effect'
import type { Provider } from '@/components/chat/chatComponentTypes'
import {
  activeStreamsStorage,
  clearActiveStream,
  extractToolTabIds,
  getAllActiveStreams,
  setActiveStream,
} from '@/lib/active-stream/active-stream-storage'
import { Capabilities, Feature } from '@/lib/browseros/capabilities'
import { useAgentServerUrl } from '@/lib/browseros/useBrowserOSProviders'
import type { ChatAction } from '@/lib/chat-actions/types'
import {
  CONVERSATION_RESET_EVENT,
  GLOW_STOP_CLICKED_EVENT,
  MESSAGE_DISLIKE_EVENT,
  MESSAGE_LIKE_EVENT,
  MESSAGE_SENT_EVENT,
  PROVIDER_SELECTED_EVENT,
} from '@/lib/constants/analyticsEvents'
import {
  conversationStorage,
  useConversations,
} from '@/lib/conversations/conversationStorage'
import { formatConversationHistory } from '@/lib/conversations/formatConversationHistory'
import { declinedAppsStorage } from '@/lib/declined-apps/storage'
import { useGraphqlQuery } from '@/lib/graphql/useGraphqlQuery'
import { createDefaultBrowserOSProvider } from '@/lib/llm-providers/storage'
import { useLlmProviders } from '@/lib/llm-providers/useLlmProviders'
import { track } from '@/lib/metrics/track'
import { searchActionsStorage } from '@/lib/search-actions/searchActionsStorage'
import { stopAgentStorage } from '@/lib/stop-agent/stop-agent-storage'
import { selectedWorkspaceStorage } from '@/lib/workspace/workspace-storage'
import type { ChatMode } from './chatTypes'
import { GetConversationWithMessagesDocument } from './graphql/chatSessionDocument'
import { useChatRefs } from './useChatRefs'
import { useNotifyActiveTab } from './useNotifyActiveTab'
import { useRemoteConversationSave } from './useRemoteConversationSave'

const getLastMessageText = (messages: UIMessage[]) => {
  const lastMessage = messages[messages.length - 1]
  if (!lastMessage) return ''
  return lastMessage.parts
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('')
}

export const getResponseAndQueryFromMessageId = (
  messages: UIMessage[],
  messageId: string,
) => {
  const messageIndex = messages.findIndex((each) => each.id === messageId)
  const response = messages?.[messageIndex] ?? []
  const query = messages?.[messageIndex - 1] ?? []
  const responseText = response.parts
    .filter((each) => each.type === 'text')
    .map((each) => each.text)
    .join('\n\n')
  const queryText = query.parts
    .filter((each) => each.type === 'text')
    .map((each) => each.text)
    .join('\n')

  return {
    responseText,
    queryText,
  }
}

export type ChatOrigin = 'sidepanel' | 'newtab'

export interface ChatSessionOptions {
  origin?: ChatOrigin
  /** When false, messages are queued until integrations finish syncing. */
  isIntegrationsSynced?: boolean
}

const NEWTAB_SYSTEM_PROMPT = `IMPORTANT: The user is chatting from the New Tab page. When performing browser actions, ALWAYS open content in a NEW TAB rather than navigating the current tab. The user's new tab page should remain accessible.`

export const useChatSession = (options?: ChatSessionOptions) => {
  const {
    selectedLlmProviderRef,
    enabledMcpServersRef,
    enabledCustomServersRef,
    personalizationRef,
    selectedLlmProvider,
    isLoadingProviders,
  } = useChatRefs()

  const { providers: llmProviders, setDefaultProvider } = useLlmProviders()

  const {
    baseUrl: agentServerUrl,
    isLoading: isLoadingAgentUrl,
    error: agentUrlError,
  } = useAgentServerUrl()

  const { saveConversation: saveLocalConversation } = useConversations()
  const {
    isLoggedIn,
    saveConversation: saveRemoteConversation,
    resetConversation: resetRemoteConversation,
    markMessagesAsSaved,
  } = useRemoteConversationSave()
  const [searchParams, setSearchParams] = useSearchParams()
  const conversationIdParam = searchParams.get('conversationId')

  const agentUrlRef = useRef(agentServerUrl)

  useEffect(() => {
    agentUrlRef.current = agentServerUrl
  }, [agentServerUrl])

  const providers: Provider[] = llmProviders.map((p) => ({
    id: p.id,
    name: p.name,
    type: p.type,
  }))

  const [mode, setMode] = useState<ChatMode>('agent')
  const [textToAction, setTextToAction] = useState<Map<string, ChatAction>>(
    new Map(),
  )
  const [liked, setLiked] = useState<Record<string, boolean>>({})
  const [disliked, setDisliked] = useState<Record<string, boolean>>({})
  const [conversationId, setConversationId] = useState(crypto.randomUUID())
  const conversationIdRef = useRef(conversationId)

  useEffect(() => {
    conversationIdRef.current = conversationId
  }, [conversationId])

  // Multi-tab stream sync: leader broadcasts, followers display
  const isLeaderRef = useRef(false)
  const isFollowingRef = useRef(false)
  const optedOutRef = useRef(false)
  const [isFollowing, setIsFollowing] = useState(false)
  const [followedMessages, setFollowedMessages] = useState<UIMessage[]>([])
  const [followedStatus, setFollowedStatus] = useState<ChatStatus>('ready')

  const onClickLike = (messageId: string) => {
    const { responseText, queryText } = getResponseAndQueryFromMessageId(
      messages,
      messageId,
    )

    track(MESSAGE_LIKE_EVENT, { responseText, queryText, messageId })

    setLiked((prev) => ({
      ...prev,
      [messageId]: !prev[messageId],
    }))
  }

  const onClickDislike = (messageId: string, comment?: string) => {
    const { responseText, queryText } = getResponseAndQueryFromMessageId(
      messages,
      messageId,
    )

    track(MESSAGE_DISLIKE_EVENT, {
      responseText,
      queryText,
      messageId,
      comment,
    })

    setDisliked((prev) => ({
      ...prev,
      [messageId]: !prev[messageId],
    }))
  }

  const modeRef = useRef<ChatMode>(mode)
  const textToActionRef = useRef<Map<string, ChatAction>>(textToAction)
  const workingDirRef = useRef<string | undefined>(undefined)
  const messagesRef = useRef<UIMessage[]>([])

  useEffect(() => {
    selectedWorkspaceStorage.getValue().then((folder) => {
      workingDirRef.current = folder?.path
    })

    const unwatch = selectedWorkspaceStorage.watch((folder) => {
      workingDirRef.current = folder?.path
    })
    return () => unwatch()
  }, [])

  useDeepCompareEffect(() => {
    modeRef.current = mode
    textToActionRef.current = textToAction
  }, [mode, textToAction])

  const selectedProvider = selectedLlmProvider
    ? {
        id: selectedLlmProvider.id,
        name: selectedLlmProvider.name,
        type:
          selectedLlmProvider.id === 'browseros'
            ? ('browseros' as const)
            : selectedLlmProvider.type,
      }
    : providers[0]

  const {
    messages,
    sendMessage: baseSendMessage,
    setMessages,
    status,
    stop,
    error: chatError,
  } = useChat({
    transport: new DefaultChatTransport({
      // Important: this chat logic is also used in apps/agent/lib/schedules/getChatServerResponse.ts for scheduled jobs. Make sure to keep them in sync for any future changes.
      prepareSendMessagesRequest: async ({ messages }) => {
        const activeTabsList = await chrome.tabs.query({
          active: true,
          currentWindow: true,
        })
        const activeTab = activeTabsList?.[0] ?? undefined
        const message = getLastMessageText(messages)
        const provider =
          selectedLlmProviderRef.current ?? createDefaultBrowserOSProvider()
        const currentMode = modeRef.current
        const enabledMcpServers = enabledMcpServersRef.current
        const customMcpServers = enabledCustomServersRef.current

        const getActionForMessage = (messageText: string) => {
          return textToActionRef.current.get(messageText)
        }

        const action = getActionForMessage(message)

        const browserContext: {
          windowId?: number
          activeTab?: {
            id?: number
            url?: string
            title?: string
          }
          selectedTabs?: {
            id?: number
            url?: string
            title?: string
          }[]
          enabledMcpServers?: string[]
          customMcpServers?: {
            name: string
            url: string
          }[]
        } = {}

        if (activeTab) {
          browserContext.windowId = activeTab.windowId
          browserContext.activeTab = {
            id: activeTab.id,
            url: activeTab.url,
            title: activeTab.title,
          }
        }

        if (action?.tabs?.length) {
          browserContext.selectedTabs = action?.tabs?.map((tab) => ({
            id: tab.id,
            url: tab.url,
            title: tab.title,
          }))
        }

        if (enabledMcpServers.length) {
          browserContext.enabledMcpServers = compact(enabledMcpServers)
        }

        if (customMcpServers.length) {
          browserContext.customMcpServers = customMcpServers as {
            name: string
            url: string
          }[]
        }

        const declinedApps = await declinedAppsStorage.getValue()

        const supportsArrayConversation = await Capabilities.supports(
          Feature.PREVIOUS_CONVERSATION_ARRAY,
        )

        const previousMessages = messagesRef.current
        const history =
          previousMessages.length > 0
            ? formatConversationHistory(previousMessages)
            : undefined
        const previousConversation = history?.length
          ? supportsArrayConversation
            ? history
            : history.map((m) => `${m.role}: ${m.content}`).join('\n')
          : undefined

        return {
          api: `${agentUrlRef.current}/chat`,
          body: {
            message,
            provider: provider?.type,
            providerType: provider?.type,
            providerName: provider?.name,
            apiKey: provider?.apiKey,
            baseUrl: provider?.baseUrl,
            conversationId: conversationIdRef.current,
            model: provider?.modelId ?? 'default',
            mode: currentMode,
            contextWindowSize: provider?.contextWindow,
            temperature: provider?.temperature,
            // Azure-specific
            resourceName: provider?.resourceName,
            // Bedrock-specific
            accessKeyId: provider?.accessKeyId,
            secretAccessKey: provider?.secretAccessKey,
            region: provider?.region,
            sessionToken: provider?.sessionToken,
            browserContext,
            userSystemPrompt:
              options?.origin === 'newtab'
                ? [personalizationRef.current, NEWTAB_SYSTEM_PROMPT]
                    .filter(Boolean)
                    .join('\n\n')
                : personalizationRef.current,
            userWorkingDir: workingDirRef.current,
            supportsImages: provider?.supportsImages,
            previousConversation,
            declinedApps: declinedApps.length > 0 ? declinedApps : undefined,
          },
        }
      },
    }),
  })

  // Remove messages with empty parts (e.g. interrupted assistant responses)
  // to prevent AI SDK validation errors on subsequent sends
  useEffect(() => {
    if (status === 'streaming') return
    if (messages.some((m) => !m.parts?.length)) {
      setMessages(messages.filter((m) => m.parts?.length > 0))
    }
  }, [messages, status, setMessages])

  useNotifyActiveTab({
    messages: isFollowing ? followedMessages : messages,
    status: isFollowing ? followedStatus : status,
    conversationId: conversationIdRef.current,
  })

  // Leader: broadcast stream state to shared storage (debounced)
  const writeTimeoutRef = useRef<ReturnType<typeof setTimeout>>()
  useEffect(() => {
    if (!isLeaderRef.current) return

    const isStreaming = status === 'streaming' || status === 'submitted'
    const isFinished = status === 'ready' || status === 'error'
    const followerTabIds = extractToolTabIds(messages)

    if (isStreaming) {
      clearTimeout(writeTimeoutRef.current)
      writeTimeoutRef.current = setTimeout(() => {
        setActiveStream({
          conversationId,
          messages,
          status,
          lastUpdated: Date.now(),
          followerTabIds,
        })
      }, 300)
      return () => clearTimeout(writeTimeoutRef.current)
    }

    if (isFinished && messages.length > 0) {
      clearTimeout(writeTimeoutRef.current)
      setActiveStream({
        conversationId,
        messages,
        status,
        lastUpdated: Date.now(),
        followerTabIds,
      })
      isLeaderRef.current = false
      // Clean up after followers have had time to read the final state
      setTimeout(() => {
        clearActiveStream(conversationId)
      }, 2000)
    }
  }, [messages, status, conversationId])

  // Follower: if this panel opened with no messages and there's an active
  // stream, follow it. Background only opens side panels on agent-interacted
  // tabs, so any fresh panel during streaming is a follower.
  // biome-ignore lint/correctness/useExhaustiveDependencies: must run once — re-runs tear down the watcher
  useEffect(() => {
    const STALE_THRESHOLD_MS = 10_000
    let staleCheckTimer: ReturnType<typeof setTimeout> | undefined

    const check = async () => {
      if (isLeaderRef.current || optedOutRef.current) return

      const streams = await getAllActiveStreams()

      // Find an active stream, or if we're already following, find the
      // completed stream we were following (to adopt its final messages)
      const activeStream = streams.find(
        (s) => s.status === 'streaming' || s.status === 'submitted',
      )
      const completedStream =
        !activeStream && isFollowingRef.current
          ? streams.find(
              (s) =>
                s.status === 'ready' &&
                s.conversationId === conversationIdRef.current,
            )
          : undefined

      const state = activeStream ?? completedStream

      if (!state) {
        if (isFollowingRef.current) {
          isFollowingRef.current = false
          setIsFollowing(false)
        }
        clearTimeout(staleCheckTimer)
        return
      }

      // Stream completed — adopt final messages and exit follower mode
      if (state.status === 'ready') {
        isFollowingRef.current = false
        setIsFollowing(false)
        setMessages(state.messages)
        setConversationId(
          state.conversationId as ReturnType<typeof crypto.randomUUID>,
        )
        clearTimeout(staleCheckTimer)
        return
      }

      // Stale leader detection
      if (Date.now() - state.lastUpdated > STALE_THRESHOLD_MS) {
        if (isFollowingRef.current) {
          isFollowingRef.current = false
          setIsFollowing(false)
        }
        clearTimeout(staleCheckTimer)
        return
      }

      isFollowingRef.current = true
      setIsFollowing(true)
      setFollowedMessages(state.messages)
      setFollowedStatus(state.status)
      setConversationId(
        state.conversationId as ReturnType<typeof crypto.randomUUID>,
      )
      clearTimeout(staleCheckTimer)
      staleCheckTimer = setTimeout(check, STALE_THRESHOLD_MS + 500)
    }

    // Only auto-follow if this panel has no conversation of its own
    if (messagesRef.current.length === 0) {
      check()
    }

    const unwatchStreams = activeStreamsStorage.watch(() => {
      if (isFollowingRef.current || messagesRef.current.length === 0) {
        check()
      }
    })

    return () => {
      unwatchStreams()
      clearTimeout(staleCheckTimer)
    }
  }, [])

  const {
    data: remoteConversationData,
    isFetched: isRemoteConversationFetched,
  } = useGraphqlQuery(
    GetConversationWithMessagesDocument,
    { conversationId: conversationIdParam ?? '' },
    {
      enabled: !!conversationIdParam && isLoggedIn,
    },
  )

  const [restoredConversationId, setRestoredConversationId] = useState<
    string | null
  >(null)

  // biome-ignore lint/correctness/useExhaustiveDependencies: restore should only run when query data arrives or conversationIdParam changes
  useEffect(() => {
    if (!conversationIdParam) return
    if (restoredConversationId === conversationIdParam) return

    if (isLoggedIn) {
      if (!isRemoteConversationFetched) return

      if (remoteConversationData?.conversation) {
        const restoredMessages =
          remoteConversationData.conversation.conversationMessages.nodes
            .filter((node): node is NonNullable<typeof node> => node !== null)
            .map((node) => node.message as UIMessage)

        setConversationId(
          conversationIdParam as ReturnType<typeof crypto.randomUUID>,
        )
        setMessages(restoredMessages)
        markMessagesAsSaved(conversationIdParam, restoredMessages)
      }
      setRestoredConversationId(conversationIdParam)
      setSearchParams({}, { replace: true })
    } else {
      const restoreLocal = async () => {
        const conversations = await conversationStorage.getValue()
        const conversation = conversations?.find(
          (c) => c.id === conversationIdParam,
        )

        if (conversation) {
          setConversationId(
            conversation.id as ReturnType<typeof crypto.randomUUID>,
          )
          setMessages(conversation.messages)
        }
        setRestoredConversationId(conversationIdParam)
        setSearchParams({}, { replace: true })
      }
      restoreLocal()
    }
  }, [conversationIdParam, remoteConversationData, isLoggedIn])

  // Keep messagesRef in sync on every change (cheap ref assignment)
  useEffect(() => {
    messagesRef.current = messages
  }, [messages])

  // Save conversation only after streaming completes — not on every token
  const previousStatusRef = useRef(status)
  // biome-ignore lint/correctness/useExhaustiveDependencies: only save when streaming finishes
  useEffect(() => {
    const wasStreaming =
      previousStatusRef.current === 'streaming' ||
      previousStatusRef.current === 'submitted'
    const justFinished = wasStreaming && status === 'ready'
    previousStatusRef.current = status

    if (!justFinished) return

    const messagesToSave = messages.filter((m) => m.parts?.length > 0)
    if (messagesToSave.length === 0) return

    if (isLoggedIn) {
      saveRemoteConversation(conversationIdRef.current, messagesToSave)
    } else {
      saveLocalConversation(conversationIdRef.current, messagesToSave)
    }
  }, [status])

  const isIntegrationsSynced = options?.isIntegrationsSynced ?? true
  const isIntegrationsSyncedRef = useRef(isIntegrationsSynced)
  const pendingMessageRef = useRef<{
    text: string
    action?: ChatAction
  } | null>(null)

  useEffect(() => {
    isIntegrationsSyncedRef.current = isIntegrationsSynced
  }, [isIntegrationsSynced])

  // Flush pending message when integrations sync completes
  useEffect(() => {
    if (isIntegrationsSynced && pendingMessageRef.current) {
      const pending = pendingMessageRef.current
      pendingMessageRef.current = null
      if (pending.action) {
        setTextToAction((prev) => {
          const next = new Map(prev)
          next.set(pending.text, pending.action!)
          return next
        })
      }
      baseSendMessage({ text: pending.text })
    }
  }, [isIntegrationsSynced, baseSendMessage])

  const sendMessage = (params: { text: string; action?: ChatAction }) => {
    isLeaderRef.current = true
    isFollowingRef.current = false
    optedOutRef.current = false
    setIsFollowing(false)

    track(MESSAGE_SENT_EVENT, {
      mode,
      provider_type: selectedLlmProvider?.type,
      model: selectedLlmProvider?.modelId,
    })

    if (!isIntegrationsSyncedRef.current) {
      // Queue the message — will be sent when sync completes
      pendingMessageRef.current = params
      return
    }

    if (params.action) {
      const action = params.action
      setTextToAction((prev) => {
        const next = new Map(prev)
        next.set(params.text, action)
        return next
      })
    }
    baseSendMessage({ text: params.text })
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: only need to run this once
  useEffect(() => {
    const unwatch = searchActionsStorage.watch((storageAction) => {
      if (storageAction) {
        setMode(storageAction.mode)
        sendMessage({ text: storageAction.query, action: storageAction.action })
      }
    })
    return () => unwatch()
  }, [])

  // biome-ignore lint/correctness/useExhaustiveDependencies: only need to run this once
  useEffect(() => {
    const unwatch = stopAgentStorage.watch((signal) => {
      if (signal && signal.conversationId === conversationIdRef.current) {
        stop()
        track(GLOW_STOP_CLICKED_EVENT)
        stopAgentStorage.setValue(null)
      }
    })
    return () => unwatch()
  }, [])

  const handleSelectProvider = (provider: Provider) => {
    track(PROVIDER_SELECTED_EVENT, {
      provider_id: provider.id,
      provider_type: provider.type,
    })
    setDefaultProvider(provider.id)
  }

  const getActionForMessage = (message: UIMessage) => {
    if (message.role !== 'user') return undefined
    const text = message.parts
      .filter((part) => part.type === 'text')
      .map((part) => part.text)
      .join('')
    return textToAction.get(text)
  }

  const resetConversation = () => {
    track(CONVERSATION_RESET_EVENT, { message_count: messages.length })
    stop()
    if (isLeaderRef.current) {
      clearActiveStream(conversationIdRef.current)
      isLeaderRef.current = false
    }
    isFollowingRef.current = false
    optedOutRef.current = true
    setIsFollowing(false)
    setFollowedMessages([])
    setConversationId(crypto.randomUUID())
    setMessages([])
    setTextToAction(new Map())
    setLiked({})
    setDisliked({})
    setRestoredConversationId(null)
    resetRemoteConversation()
  }

  const isRestoringConversation =
    !!conversationIdParam && restoredConversationId !== conversationIdParam

  const stopFollowedStream = () => {
    stopAgentStorage.setValue({
      conversationId: conversationIdRef.current,
      timestamp: Date.now(),
    })
  }

  return {
    mode,
    setMode,
    messages: isFollowing ? followedMessages : messages,
    sendMessage,
    status: isFollowing ? followedStatus : status,
    stop: isFollowing ? stopFollowedStream : stop,
    providers,
    selectedProvider,
    isLoading: isLoadingProviders || isLoadingAgentUrl,
    isSyncing: !isIntegrationsSynced,
    isRestoringConversation,
    isFollowing,
    agentUrlError,
    chatError,
    handleSelectProvider,
    getActionForMessage,
    resetConversation,
    liked,
    onClickLike,
    disliked,
    onClickDislike,
    conversationId,
  }
}
