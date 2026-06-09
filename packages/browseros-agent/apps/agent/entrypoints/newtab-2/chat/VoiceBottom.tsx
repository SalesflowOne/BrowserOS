import { Mic, X } from 'lucide-react'
import { motion } from 'motion/react'
import type { FC } from 'react'
import { useSearchParams } from 'react-router'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useComposer } from '../ComposerProvider'
import { useChatSession } from './ChatSessionProvider'
import type { ChatBlock, ChatMode } from './chat-screen.types'
import { VoiceOrb, type VoiceOrbState } from './VoiceOrb'

const ORANGE_LISTEN_CAPTION = 'Listening…'

export const VoiceBottom: FC = () => {
  const [searchParams, setSearchParams] = useSearchParams()
  const { voice } = useComposer()
  const { blocks } = useChatSession()

  const lastAgentText = findLatestAgentPrompt(blocks)
  const caption =
    voice.isRecording && !lastAgentText
      ? ORANGE_LISTEN_CAPTION
      : (lastAgentText ?? ORANGE_LISTEN_CAPTION)

  const orbState: VoiceOrbState = voice.isRecording
    ? 'listening'
    : voice.isTranscribing
      ? 'speaking'
      : 'idle'

  const captionIsListening = caption === ORANGE_LISTEN_CAPTION

  const switchTo = (next: ChatMode) => {
    if (next === 'voice' && !voice.isRecording) void voice.startRecording()
    if (next === 'text' && voice.isRecording) void voice.stopRecording()
    const params = new URLSearchParams(searchParams)
    params.set('mode', next)
    setSearchParams(params, { replace: true })
  }

  const handleClose = () => switchTo('text')
  const handleMicToggle = () => {
    if (voice.isRecording) {
      void voice.stopRecording()
      return
    }
    void voice.startRecording()
  }

  return (
    <div className="flex flex-col items-center">
      <motion.div
        initial={{ opacity: 0, scale: 0.85 }}
        animate={{
          opacity: 1,
          scale: 1,
          transition: { duration: 0.18, ease: 'easeOut' },
        }}
        className="shrink-0"
      >
        <VoiceOrb size={232} state={orbState} accent="#E8722E" />
      </motion.div>

      <p
        className={cn(
          'mt-1.5 min-h-[26px] max-w-[560px] px-5 text-center font-medium text-[17px] text-[var(--accent-orange)] leading-[1.45]',
          captionIsListening && 'font-normal text-muted-foreground italic',
        )}
      >
        {caption}
      </p>

      <div className="mt-5 flex gap-[26px]">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={handleClose}
          aria-label="Close voice"
          className="size-14 rounded-full bg-white text-[#6b6b6b] shadow-[0_2px_10px_rgba(0,0,0,0.08)] hover:bg-white"
        >
          <X className="size-5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={handleMicToggle}
          aria-label={voice.isRecording ? 'Stop listening' : 'Start listening'}
          aria-pressed={voice.isRecording}
          className={cn(
            'size-14 rounded-full bg-white text-[#6b6b6b] shadow-[0_2px_10px_rgba(0,0,0,0.08)] hover:bg-white',
            voice.isRecording &&
              'bg-[var(--accent-orange)] text-white shadow-[0_0_0_6px_rgba(226,114,44,0.18)] hover:bg-[var(--accent-orange-bright)]',
          )}
        >
          <Mic className="size-[22px]" />
        </Button>
      </div>
    </div>
  )
}

function findLatestAgentPrompt(blocks: ChatBlock[]): string | null {
  for (let i = blocks.length - 1; i >= 0; i--) {
    const block = blocks[i]
    if (block.type === 'note') return block.text
    if (block.type === 'thought' && block.runningLabel)
      return block.runningLabel
  }
  return null
}
