import {
  createContext,
  type FC,
  type ReactNode,
  useCallback,
  useContext,
  useRef,
  useState,
} from 'react'
import { useNavigate } from 'react-router'
import {
  type UseVoiceInputReturn,
  useVoiceInput,
} from '@/lib/voice/useVoiceInput'
import type { ChatMode } from './chat/chat-screen.types'

interface ChatHandlers {
  onSubmit?: (text: string) => void
  onSwitchToVoice?: () => void
}

interface ComposerContextValue {
  value: string
  setValue: (next: string) => void
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

export const ComposerProvider: FC<{ children: ReactNode }> = ({ children }) => {
  const [value, setValue] = useState('')
  const [selectedTabs, setSelectedTabs] = useState<chrome.tabs.Tab[]>([])
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const [submittedAt, setSubmittedAt] = useState<number | null>(null)
  const [transitionIntent, setTransitionIntent] = useState<ChatMode | null>(
    null,
  )
  const chatHandlersRef = useRef<ChatHandlers>({})
  const voice = useVoiceInput()
  const navigate = useNavigate()

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
  }, [])

  const registerChatHandlers = useCallback((handlers: ChatHandlers) => {
    chatHandlersRef.current = handlers
    return () => {
      if (chatHandlersRef.current === handlers) {
        chatHandlersRef.current = {}
      }
    }
  }, [])

  const submit = useCallback(() => {
    const text = value.trim()
    if (!text) return
    const handler = chatHandlersRef.current.onSubmit
    if (handler) {
      handler(text)
      setValue('')
      return
    }
    setSubmittedAt(Date.now())
    setTransitionIntent('text')
    navigate(`/newtab-2/chat?mode=text`, {
      state: { initialMessage: text, initialMode: 'text', initialVoice: false },
    })
  }, [navigate, value])

  const triggerVoice = useCallback(() => {
    const handler = chatHandlersRef.current.onSwitchToVoice
    if (handler) {
      handler()
      return
    }
    setSubmittedAt(Date.now())
    setTransitionIntent('voice')
    void voice.startRecording()
    navigate(`/newtab-2/chat?mode=voice`, {
      state: {
        initialMessage: value,
        initialMode: 'voice',
        initialVoice: true,
      },
    })
  }, [navigate, value, voice.startRecording])

  return (
    <ComposerContext.Provider
      value={{
        value,
        setValue,
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
