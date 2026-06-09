import {
  createContext,
  type FC,
  type ReactNode,
  useCallback,
  useContext,
  useState,
} from 'react'
import { DEMO_MODE } from './demo-config'
import { type DemoDirector, useDemoDirector } from './useDemoDirector'

interface ChatSessionContextValue extends DemoDirector {
  hasSession: boolean
}

interface ChatSessionControlsValue {
  initialMessage: string | null
  startSession: (initialMessage: string) => void
  resetSession: () => void
}

const ChatSessionContext = createContext<ChatSessionContextValue | null>(null)
const ChatSessionControlsContext =
  createContext<ChatSessionControlsValue | null>(null)

const EMPTY_SESSION: ChatSessionContextValue = {
  blocks: [],
  gateActive: false,
  founderPlaceholder: null,
  submitFounderReply: () => {},
  hasSession: false,
}

export const ChatSessionProvider: FC<{ children: ReactNode }> = ({
  children,
}) => {
  const [initialMessage, setInitialMessage] = useState<string | null>(null)
  const [epoch, setEpoch] = useState(0)

  const startSession = useCallback((next: string) => {
    setInitialMessage((current) => {
      if (current === next) return current
      setEpoch((e) => e + 1)
      return next
    })
  }, [])

  const resetSession = useCallback(() => {
    setInitialMessage(null)
    setEpoch((e) => e + 1)
  }, [])

  return (
    <ChatSessionControlsContext.Provider
      value={{ initialMessage, startSession, resetSession }}
    >
      {initialMessage ? (
        <DirectorScope key={`${epoch}`} initialMessage={initialMessage}>
          {children}
        </DirectorScope>
      ) : (
        <ChatSessionContext.Provider value={EMPTY_SESSION}>
          {children}
        </ChatSessionContext.Provider>
      )}
    </ChatSessionControlsContext.Provider>
  )
}

interface DirectorScopeProps {
  initialMessage: string
  children: ReactNode
}

const DirectorScope: FC<DirectorScopeProps> = ({
  initialMessage,
  children,
}) => {
  // SEAM: swap useDemoDirector for the live streaming hook when DEMO_MODE is off.
  const director = useDemoDirector(initialMessage, DEMO_MODE)
  return (
    <ChatSessionContext.Provider value={{ ...director, hasSession: true }}>
      {children}
    </ChatSessionContext.Provider>
  )
}

export const useChatSession = (): ChatSessionContextValue => {
  const ctx = useContext(ChatSessionContext)
  if (!ctx) {
    throw new Error('useChatSession must be used inside <ChatSessionProvider>')
  }
  return ctx
}

export const useChatSessionControls = (): ChatSessionControlsValue => {
  const ctx = useContext(ChatSessionControlsContext)
  if (!ctx) {
    throw new Error(
      'useChatSessionControls must be used inside <ChatSessionProvider>',
    )
  }
  return ctx
}
