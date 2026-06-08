import { motion } from 'motion/react'
import type { FC } from 'react'
import { Kbd } from '@/components/ui/kbd'
import { BrowserOSIcon } from '@/lib/llm-providers/providerIcons'
import { useComposer } from './ComposerProvider'

// Matches the natural height of <Composer /> with no chips attached.
// The hoisted ComposerLayer overlays this invisible slot so the chrome
// (icon above, hint below) flows around the right vertical space.
const COMPOSER_SLOT_HEIGHT = 100

export const NewTabTwo: FC = () => {
  const { voice, transitionIntent } = useComposer()

  const hint = voice.isTranscribing
    ? 'Transcribing your brief…'
    : voice.isRecording
      ? 'Listening… press the mic again to stop'
      : null

  const pageExit =
    transitionIntent === 'voice'
      ? { opacity: 0, transition: { duration: 0.12, ease: 'easeIn' as const } }
      : { opacity: 0, transition: { duration: 0.22, ease: 'easeIn' as const } }

  return (
    <motion.div
      initial={{ opacity: 1 }}
      animate={{ opacity: 1 }}
      exit={pageExit}
      className="flex h-screen w-screen flex-col bg-[radial-gradient(110%_80%_at_50%_38%,#FFE9D6_0%,#FDF0E6_32%,var(--background)_70%)]"
    >
      <main className="relative flex flex-1 flex-col items-center justify-center gap-[22px]">
        <div
          aria-hidden
          className="pointer-events-none absolute top-[30%] left-1/2 h-[360px] w-[720px] -translate-x-1/2 -translate-y-[30%] rounded-full blur-[8px] [background:radial-gradient(closest-side,rgba(226,114,44,0.16),transparent)]"
        />

        <div className="z-10 flex size-[60px] items-center justify-center rounded-[18px] bg-white shadow-[0_8px_30px_rgba(226,114,44,0.20)]">
          <BrowserOSIcon size={40} />
        </div>

        <div
          aria-hidden
          className="w-[660px]"
          style={{ height: COMPOSER_SLOT_HEIGHT }}
        />

        <p className="z-10 whitespace-nowrap text-[13px] text-muted-foreground">
          {hint ?? (
            <>
              Press the mic to brief your agent by voice
              <Kbd className="mx-1.5 h-auto rounded-[4px] border border-border bg-white px-1.5 py-[1px] font-mono text-[10.5px]">
                space
              </Kbd>
              or click anywhere to begin
            </>
          )}
        </p>

        {voice.error && (
          <p className="z-10 text-[12px] text-destructive" role="alert">
            {voice.error}
          </p>
        )}
      </main>
    </motion.div>
  )
}
