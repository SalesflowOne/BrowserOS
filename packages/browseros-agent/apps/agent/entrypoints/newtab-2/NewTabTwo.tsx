import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ChevronDown,
  Folder,
  Mic,
  MoreHorizontal,
  PanelLeft,
  Plus,
  RotateCw,
  Search,
  Sparkles,
  User,
} from 'lucide-react'
import { type FC, type FormEventHandler, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Kbd } from '@/components/ui/kbd'
import { createBrowserOSAction } from '@/lib/chat-actions/types'
import { BrowserOSIcon } from '@/lib/llm-providers/providerIcons'
import { openSidePanelWithSearch } from '@/lib/messaging/sidepanel/openSidepanelWithSearch'
import { cn } from '@/lib/utils'
import { useVoiceInput } from '@/lib/voice/useVoiceInput'

export const NewTabTwo: FC = () => {
  const [value, setValue] = useState('')
  const voice = useVoiceInput()
  const canSend = value.trim().length > 0

  useEffect(() => {
    if (!voice.transcript) return
    setValue((prev) =>
      prev ? `${prev} ${voice.transcript}` : voice.transcript,
    )
    voice.clearTranscript()
  }, [voice.transcript, voice.clearTranscript])

  const handleSubmit: FormEventHandler<HTMLFormElement> = (e) => {
    e.preventDefault()
    const message = value.trim()
    if (!message) return
    const action = createBrowserOSAction({
      mode: 'agent',
      message,
      tabs: [],
    })
    openSidePanelWithSearch('open', {
      query: message,
      mode: 'agent',
      action,
    })
    setValue('')
  }

  const handleMicToggle = () => {
    if (voice.isRecording) {
      void voice.stopRecording()
    } else {
      void voice.startRecording()
    }
  }

  const hint = voice.isTranscribing
    ? 'Transcribing your brief…'
    : voice.isRecording
      ? 'Listening… press the mic again to stop'
      : null

  return (
    <div className="flex h-screen w-screen flex-col bg-[radial-gradient(110%_80%_at_50%_38%,#FFE9D6_0%,#FDF0E6_32%,var(--background)_70%)]">
      <header className="flex h-11 shrink-0 items-center gap-[14px] px-4 text-[#8a8378]">
        <div className="flex gap-3 text-[#8a8378]">
          <span aria-hidden>
            <PanelLeft className="size-4" />
          </span>
          <span aria-hidden>
            <ArrowLeft className="size-4" />
          </span>
          <span aria-hidden>
            <ArrowRight className="size-4" />
          </span>
          <span aria-hidden>
            <RotateCw className="size-[15px]" />
          </span>
        </div>
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[#8a8378] text-[12.5px]">
          <Folder className="size-3.5" aria-hidden />
          Imported From…
          <ChevronDown className="size-3.5" aria-hidden />
        </span>
        <div className="ml-auto flex gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-md bg-white/50 px-[9px] py-1 text-[#9a9388] text-[12px]">
            <Sparkles className="size-3.5" aria-hidden />
            Skills
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-md bg-white/50 px-[9px] py-1 text-[#9a9388] text-[12px]">
            <User className="size-3.5" aria-hidden />
            Personalization
          </span>
        </div>
      </header>

      <main className="relative flex flex-1 flex-col items-center justify-center gap-[22px]">
        <div
          aria-hidden
          className="pointer-events-none absolute top-[30%] left-1/2 h-[360px] w-[720px] -translate-x-1/2 -translate-y-[30%] rounded-full blur-[8px] [background:radial-gradient(closest-side,rgba(226,114,44,0.16),transparent)]"
        />

        <div className="z-10 flex size-[60px] items-center justify-center rounded-[18px] bg-white shadow-[0_8px_30px_rgba(226,114,44,0.20)]">
          <BrowserOSIcon size={40} />
        </div>

        <form
          onSubmit={handleSubmit}
          className="z-10 w-[660px] rounded-[22px] border border-[rgba(226,114,44,0.18)] bg-white/90 px-5 pt-[18px] pb-3 shadow-[0_16px_50px_-10px_rgba(226,114,44,0.28),0_0_0_6px_rgba(226,114,44,0.05)]"
        >
          <div className="flex items-center gap-3">
            <Search className="size-[18px] text-muted-foreground" aria-hidden />
            <Input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="Ask anything, or brief your marketing agent…"
              aria-label="Ask anything, or brief your marketing agent"
              autoFocus
              className="h-auto w-full border-0 bg-transparent p-0 text-[16px] shadow-none placeholder:text-[color-mix(in_oklch,var(--muted-foreground)_80%,transparent)] focus-visible:border-0 focus-visible:ring-0"
            />
          </div>

          <div className="mt-3 flex items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="h-7 gap-1.5 rounded-full bg-black/5 px-[11px] py-[5px] font-normal text-[12.5px] text-muted-foreground hover:bg-black/10"
            >
              <Plus className="size-3.5" aria-hidden />
              Add tabs or files
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground"
              aria-label="More options"
            >
              <MoreHorizontal className="size-[15px]" />
            </Button>

            <span className="flex-1" />

            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={
                voice.isRecording ? 'Stop voice input' : 'Start voice input'
              }
              aria-pressed={voice.isRecording}
              disabled={voice.isTranscribing}
              onClick={handleMicToggle}
              className={cn(
                'size-[34px] rounded-full bg-[oklch(0.6781_0.1663_43.21/0.10)] text-[var(--accent-orange)] hover:bg-[oklch(0.6781_0.1663_43.21/0.18)]',
                !voice.isRecording &&
                  !voice.isTranscribing &&
                  'animate-[nt-mic-pulse_2s_ease-in-out_infinite]',
              )}
            >
              <Mic className="size-[17px]" />
            </Button>

            <Button
              type="submit"
              size="icon"
              disabled={!canSend}
              aria-label="Send"
              className="size-[34px] rounded-full bg-[var(--accent-orange)] text-white hover:bg-[var(--accent-orange-bright)]"
            >
              <ArrowUp className="size-4" />
            </Button>
          </div>
        </form>

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
    </div>
  )
}
