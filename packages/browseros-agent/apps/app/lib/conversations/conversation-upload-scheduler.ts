import type { Conversation } from './conversationStorage'

const DEFAULT_UPLOAD_DEBOUNCE_MS = 1000

/** Creates a newest-wins debounce that never runs more than one conversation upload at a time. */
export function createConversationUploadScheduler(
  upload: (conversations: Conversation[]) => Promise<void>,
  options: {
    delayMs?: number
    onError?: (error: unknown) => void
  } = {},
) {
  const { delayMs = DEFAULT_UPLOAD_DEBOUNCE_MS, onError = () => undefined } =
    options
  let timeout: ReturnType<typeof setTimeout> | undefined
  let pendingConversations: Conversation[] | undefined
  let uploadInProgress = false

  function armTimeout() {
    if (timeout !== undefined || uploadInProgress || !pendingConversations)
      return
    timeout = setTimeout(() => {
      timeout = undefined
      void flush()
    }, delayMs)
  }

  async function flush() {
    if (uploadInProgress || !pendingConversations) return
    const conversations = pendingConversations
    pendingConversations = undefined
    uploadInProgress = true

    try {
      await upload(conversations)
    } catch (error) {
      onError(error)
    } finally {
      uploadInProgress = false
      armTimeout()
    }
  }

  return (conversations: Conversation[]) => {
    if (timeout !== undefined) clearTimeout(timeout)
    timeout = undefined
    if (conversations.length === 0) {
      pendingConversations = undefined
      return
    }
    pendingConversations = conversations
    armTimeout()
  }
}
