import { type FC, useState } from 'react'
import { useLocation, useSearchParams } from 'react-router'
import { useComposer } from '../ComposerProvider'
import { AgentChat } from './AgentChat'
import type { ChatMode } from './chat-screen.types'

interface ChatLocationState {
  initialMessage?: string
  initialMode?: ChatMode
  initialVoice?: boolean
}

export const ChatScreen: FC = () => {
  const [searchParams, setSearchParams] = useSearchParams()
  const location = useLocation()
  const composer = useComposer()
  const { voice } = composer

  const queryMode = (searchParams.get('mode') as ChatMode | null) ?? 'text'
  const state = (location.state ?? null) as ChatLocationState | null
  const [initialMessage] = useState<string>(
    state?.initialMessage ?? composer.value ?? '',
  )

  const switchTo = (next: ChatMode) => {
    if (next === 'voice' && !voice.isRecording) void voice.startRecording()
    if (next === 'text' && voice.isRecording) void voice.stopRecording()
    const params = new URLSearchParams(searchParams)
    params.set('mode', next)
    setSearchParams(params, { replace: true })
  }

  return (
    <div className="h-screen w-screen overflow-hidden bg-background">
      <AgentChat
        initialMessage={initialMessage}
        mode={queryMode}
        onSwitchToVoice={() => switchTo('voice')}
      />
    </div>
  )
}
