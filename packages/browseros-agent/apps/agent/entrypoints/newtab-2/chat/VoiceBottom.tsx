import { Mic, X } from 'lucide-react'
import { motion } from 'motion/react'
import type { FC } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useComposer } from '../ComposerProvider'
import { useChatSession } from './ChatSessionProvider'
import type { ChatBlock } from './chat-screen.types'
import { VoiceOrb, type VoiceOrbState } from './VoiceOrb'

const ORANGE_LISTEN_CAPTION = 'Listening…'

interface VoiceBottomProps {
  /**
   * Called when the user dismisses the voice surface (X or mic-off path).
   * Caller is responsible for moving the surface back to text mode.
   * VoiceBottom stops the active recording locally before invoking this.
   */
  onSwitchToText: () => void
  /**
   * Compact mode renders a smaller orb and tighter controls for small
   * surfaces (LinkedIn popup).
   */
  compact?: boolean
}

export const VoiceBottom: FC<VoiceBottomProps> = ({
  onSwitchToText,
  compact = false,
}) => {
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

  const handleClose = () => {
    if (voice.isRecording) void voice.stopRecording()
    onSwitchToText()
  }
  const handleMicToggle = () => {
    if (voice.isRecording) {
      void voice.stopRecording()
      return
    }
    void voice.startRecording()
  }

  const orbSize = compact ? 168 : 232
  const controlSize = compact ? 'size-12' : 'size-14'
  const controlIconSize = compact ? 'size-5' : 'size-[22px]'
  const closeIconSize = compact ? 'size-[18px]' : 'size-5'

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
        <VoiceOrb size={orbSize} state={orbState} accent="#E8722E" />
      </motion.div>

      <p
        className={cn(
          'min-h-[24px] max-w-[560px] text-center font-medium text-[var(--accent-orange)]',
          compact
            ? 'mt-1 px-3 text-[14.5px] leading-[1.4]'
            : 'mt-1.5 px-5 text-[17px] leading-[1.45]',
          captionIsListening && 'font-normal text-muted-foreground italic',
        )}
      >
        {caption}
      </p>

      <div className={cn('flex', compact ? 'mt-3 gap-5' : 'mt-5 gap-[26px]')}>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={handleClose}
          aria-label="Close voice"
          className={cn(
            'rounded-full bg-white text-[#6b6b6b] shadow-[0_2px_10px_rgba(0,0,0,0.08)] hover:bg-white',
            controlSize,
          )}
        >
          <X className={closeIconSize} />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={handleMicToggle}
          aria-label={voice.isRecording ? 'Stop listening' : 'Start listening'}
          aria-pressed={voice.isRecording}
          className={cn(
            'rounded-full bg-white text-[#6b6b6b] shadow-[0_2px_10px_rgba(0,0,0,0.08)] hover:bg-white',
            controlSize,
            voice.isRecording &&
              'bg-[var(--accent-orange)] text-white shadow-[0_0_0_6px_rgba(226,114,44,0.18)] hover:bg-[var(--accent-orange-bright)]',
          )}
        >
          <Mic className={controlIconSize} />
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
