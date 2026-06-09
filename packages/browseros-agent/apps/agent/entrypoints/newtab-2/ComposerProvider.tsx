import {
  createContext,
  type FC,
  type ReactNode,
  useCallback,
  useContext,
  useRef,
  useState,
} from 'react'
import {
  type UseVoiceInputReturn,
  useVoiceInput,
} from '@/lib/voice/useVoiceInput'
import type { ChatMode } from './chat/chat-screen.types'

export type ComposerTransitionHandler = (
  mode: ChatMode,
  initialMessage: string,
) => void

interface ChatHandlers {
  onSubmit?: (text: string) => void
  onSwitchToVoice?: () => void
}

interface ComposerContextValue {
  value: string
  setValue: (next: string) => void
  placeholder: string | null
  setPlaceholder: (p: string | null) => void
  selectedTabs: chrome.tabs.Tab[]
  selectedFiles: File[]
  toggleTab: (tab: chrome.tabs.Tab) => void
  addFiles: (files: File[]) => void
  removeTab: (tab: chrome.tabs.Tab) => void
  removeFile: (file: File) => void
  reset: () => void
  voice: UseVoiceInputReturn
  submittedAt: number | null
  transitionIntent: ChatMode | null
  setTransitionIntent: (intent: ChatMode | null) => void
  submit: () => void
  triggerVoice: () => void
  registerChatHandlers: (handlers: ChatHandlers) => () => void
}

const ComposerContext = createContext<ComposerContextValue | null>(null)

interface ComposerProviderProps {
  children: ReactNode
  /**
   * Called when the launcher composer wants to transition the user to a chat
   * surface. Optional: surfaces that already ARE the chat (the content-script
   * popup) leave this unset; submit and triggerVoice still work via the chat
   * handler ref so this path is never reached there.
   */
  onTransitionToChat?: ComposerTransitionHandler
}

export const ComposerProvider: FC<ComposerProviderProps> = ({
  children,
  onTransitionToChat,
}) => {
  const [value, setRawValue] = useState('')
  const valueRef = useRef('')
  const [placeholder, setPlaceholder] = useState<string | null>(null)
  const [selectedTabs, setSelectedTabs] = useState<chrome.tabs.Tab[]>([])
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const [submittedAt, setSubmittedAt] = useState<number | null>(null)
  const [transitionIntent, setTransitionIntent] = useState<ChatMode | null>(
    null,
  )
  const chatHandlersRef = useRef<ChatHandlers>({})
  const voice = useVoiceInput()
  const transitionRef = useRef(onTransitionToChat)
  transitionRef.current = onTransitionToChat

  const setValue = useCallback((next: string) => {
    valueRef.current = next
    setRawValue(next)
  }, [])

  const toggleTab = useCallback((tab: chrome.tabs.Tab) => {
    setSelectedTabs((prev) =>
      prev.some((t) => t.id === tab.id)
        ? prev.filter((t) => t.id !== tab.id)
        : [...prev, tab],
    )
  }, [])

  const addFiles = useCallback((files: File[]) => {
    setSelectedFiles((prev) => [...prev, ...files])
  }, [])

  const removeTab = useCallback((tab: chrome.tabs.Tab) => {
    setSelectedTabs((prev) => prev.filter((t) => t.id !== tab.id))
  }, [])

  const removeFile = useCallback((file: File) => {
    setSelectedFiles((prev) => prev.filter((f) => f !== file))
  }, [])

  const reset = useCallback(() => {
    setValue('')
    setSelectedTabs([])
    setSelectedFiles([])
    setSubmittedAt(null)
    setTransitionIntent(null)
  }, [setValue])

  const registerChatHandlers = useCallback((handlers: ChatHandlers) => {
    chatHandlersRef.current = handlers
    return () => {
      if (chatHandlersRef.current === handlers) {
        chatHandlersRef.current = {}
      }
    }
  }, [])

  const submit = useCallback(() => {
    const text = valueRef.current.trim()
    const handler = chatHandlersRef.current.onSubmit
    if (handler) {
      handler(text)
      setValue('')
      return
    }
    if (!text) return
    // Launcher to chat session start: clear value AND attachments so the
    // chat surface begins with an empty composer.
    setValue('')
    setSelectedTabs([])
    setSelectedFiles([])
    setSubmittedAt(Date.now())
    setTransitionIntent('text')
    transitionRef.current?.('text', text)
  }, [setValue])

  const triggerVoice = useCallback(() => {
    const text = valueRef.current
    const handler = chatHandlersRef.current.onSwitchToVoice
    if (handler) {
      handler()
      return
    }
    setSubmittedAt(Date.now())
    setTransitionIntent('voice')
    void voice.startRecording()
    transitionRef.current?.('voice', text)
  }, [voice.startRecording])

  return (
    <ComposerContext.Provider
      value={{
        value,
        setValue,
        placeholder,
        setPlaceholder,
        selectedTabs,
        selectedFiles,
        toggleTab,
        addFiles,
        removeTab,
        removeFile,
        reset,
        voice,
        submittedAt,
        transitionIntent,
        setTransitionIntent,
        submit,
        triggerVoice,
        registerChatHandlers,
      }}
    >
      {children}
    </ComposerContext.Provider>
  )
}

export const useComposer = (): ComposerContextValue => {
  const ctx = useContext(ComposerContext)
  if (!ctx) {
    throw new Error('useComposer must be used inside <ComposerProvider>')
  }
  return ctx
}
