import { cn } from '@company/lib/utils'
import { Mic } from 'lucide-react'
import type { FC } from 'react'

// Visual-only stub for v1. Voice dictation lands in a follow-up; the
// button reserves the slot in the composer toolbar and signals to
// users that the feature is on the way without leading them to expect
// it to work yet.
export const VoiceButton: FC = () => {
  return (
    <button
      type="button"
      title="Voice input · coming soon"
      aria-label="Voice input (coming soon)"
      // Disabled instead of hidden so the layout stays stable for the
      // upcoming follow-up that wires it up.
      disabled
      className={cn(
        'inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground/60 transition-colors',
        'hover:bg-accent hover:text-foreground',
        'disabled:cursor-not-allowed disabled:opacity-50',
      )}
    >
      <Mic className="size-4" />
    </button>
  )
}
