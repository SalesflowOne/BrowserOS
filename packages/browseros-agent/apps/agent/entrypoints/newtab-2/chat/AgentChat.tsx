import {
  Check,
  ChevronDown,
  ChevronUp,
  Layers,
  Loader2,
  Mic,
  Plus,
  Settings,
  Sun,
} from 'lucide-react'
import { motion } from 'motion/react'
import { type FC, useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { BrowserOSIcon } from '@/lib/llm-providers/providerIcons'
import { cn } from '@/lib/utils'
import { useComposer } from '../ComposerProvider'
import { useChatSession, useChatSessionControls } from './ChatSessionProvider'
import {
  POST2_EDIT,
  POSTS,
  TONE_NOTES,
  TRENDS,
  WARMUP,
} from './chat-screen.mock-data'
import type {
  ChatBlock,
  ChatMode,
  PostsBlock as PostsBlockT,
  ThoughtBlock,
  WarmupBlock as WarmupBlockT,
} from './chat-screen.types'
import {
  DEMO_FOUNDER_INPUT,
  DEMO_SPEED,
  DEMO_TIMING,
  DEMO_VOICE_AUTOSUBMIT,
} from './demo-config'

interface AgentChatProps {
  initialMessage?: string
  mode: ChatMode
  onSwitchToVoice: () => void
}

export const AgentChat: FC<AgentChatProps> = ({
  initialMessage,
  mode,
  onSwitchToVoice,
}) => {
  const isVoice = mode === 'voice'
  const { registerChatHandlers, setPlaceholder, setValue, submit, voice } =
    useComposer()
  const {
    blocks,
    gateActive,
    founderPlaceholder,
    submitFounderReply,
    hasSession,
  } = useChatSession()
  const { startSession } = useChatSessionControls()
  const scrollRef = useRef<HTMLDivElement>(null)
  const voiceAutosubmitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  )

  // Hoist the chat thread above the route swap: seed the session on the first
  // arrival (idempotent — same initialMessage means the existing session
  // continues, so voice↔text remounts do NOT reset the director).
  useEffect(() => {
    if (!initialMessage?.trim()) return
    startSession(initialMessage)
  }, [initialMessage, startSession])

  // Composer submits go to one of two places: if the session isn't seeded
  // yet (e.g. user reached chat via launcher voice with an empty composer
  // and is now sending the transcribed brief), this is the moment to start.
  // Otherwise hand off to the director's gated reply path.
  const handleComposerSubmit = useCallback(
    (text: string) => {
      if (!hasSession) {
        startSession(text)
        return
      }
      submitFounderReply(text)
    },
    [hasSession, startSession, submitFounderReply],
  )

  useEffect(() => {
    return registerChatHandlers({
      onSubmit: handleComposerSubmit,
      onSwitchToVoice,
    })
  }, [registerChatHandlers, handleComposerSubmit, onSwitchToVoice])

  useEffect(() => {
    setPlaceholder(gateActive ? founderPlaceholder : null)
    return () => setPlaceholder(null)
  }, [gateActive, founderPlaceholder, setPlaceholder])

  useEffect(() => {
    if (!gateActive || DEMO_FOUNDER_INPUT !== 'auto' || !founderPlaceholder) {
      return
    }

    const text = founderPlaceholder
    const timers: ReturnType<typeof setTimeout>[] = []
    let acc = DEMO_TIMING.founderTypeStartDelay * DEMO_SPEED
    setValue('')

    for (let i = 1; i <= text.length; i++) {
      timers.push(
        setTimeout(
          () => setValue(text.slice(0, i)),
          Math.round(acc + i * DEMO_TIMING.founderTypeCharMs * DEMO_SPEED),
        ),
      )
    }

    acc +=
      text.length * DEMO_TIMING.founderTypeCharMs * DEMO_SPEED +
      DEMO_TIMING.founderSubmitDelay * DEMO_SPEED
    timers.push(setTimeout(() => submit(), Math.round(acc)))

    return () => {
      for (const timer of timers) clearTimeout(timer)
    }
  }, [gateActive, founderPlaceholder, setValue, submit])

  useEffect(() => {
    if (!DEMO_VOICE_AUTOSUBMIT || !gateActive) return
    const transcript = voice.transcript.trim()
    if (!transcript) return

    if (voiceAutosubmitTimerRef.current) {
      clearTimeout(voiceAutosubmitTimerRef.current)
    }
    voiceAutosubmitTimerRef.current = setTimeout(
      () => {
        voiceAutosubmitTimerRef.current = null
        submit()
      },
      Math.round(DEMO_TIMING.founderSubmitDelay * DEMO_SPEED),
    )
  }, [gateActive, submit, voice.transcript])

  useEffect(() => {
    if (gateActive || !voiceAutosubmitTimerRef.current) return
    clearTimeout(voiceAutosubmitTimerRef.current)
    voiceAutosubmitTimerRef.current = null
  }, [gateActive])

  useEffect(() => {
    return () => {
      if (voiceAutosubmitTimerRef.current) {
        clearTimeout(voiceAutosubmitTimerRef.current)
      }
    }
  }, [])

  const warm = blocks.find(
    (block): block is WarmupBlockT => block.type === 'warmup',
  )
  const scrollKey = `${blocks.length}:${warm?.progress ?? 0}:${warm?.done ? 1 : 0}:${warm?.expanded ? 1 : 0}`

  useEffect(() => {
    void scrollKey
    const el = scrollRef.current
    if (!el) return
    const go = () => {
      el.scrollTop = el.scrollHeight
    }
    requestAnimationFrame(go)
    const timer = setTimeout(go, 90)
    return () => clearTimeout(timer)
  }, [scrollKey])

  // DOM side effect: when the mode flips, snap the thread to bottom so the
  // last block sits above the orb (voice) or just above the composer (text).
  useEffect(() => {
    void mode
    const el = scrollRef.current
    if (!el) return
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight
    })
  }, [mode])

  return (
    <div
      className={cn(
        'relative flex h-full min-h-0 flex-col bg-background',
        isVoice &&
          'bg-[radial-gradient(90%_70%_at_50%_85%,#FCEFE4_0%,var(--background)_70%)]',
      )}
    >
      <header className="flex h-12 shrink-0 items-center justify-between px-6">
        {isVoice ? (
          <span className="inline-flex items-center gap-[7px] whitespace-nowrap text-[12.5px] text-muted-foreground">
            <span className="size-[7px] animate-[fv-pulse_1.5s_ease-in-out_infinite] rounded-full bg-[var(--accent-orange)]" />
            Voice · BrowserOS agent
          </span>
        ) : (
          <span className="inline-flex items-center gap-2 whitespace-nowrap font-medium text-[13px] text-foreground">
            <BrowserOSIcon size={16} />
            BrowserOS Agent
            <ChevronDown className="size-3 text-muted-foreground" aria-hidden />
          </span>
        )}
        <div className="flex items-center gap-3 text-muted-foreground">
          {!isVoice && (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={onSwitchToVoice}
              aria-label="Switch to voice"
              className="text-muted-foreground"
            >
              <Mic className="size-4" />
            </Button>
          )}
          {!isVoice && <Plus className="size-[15px]" aria-hidden />}
          <Settings className="size-[15px]" aria-hidden />
          {!isVoice && <Sun className="size-[15px]" aria-hidden />}
        </div>
      </header>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        <div
          className={cn(
            'mx-auto flex max-w-[720px] flex-col gap-[14px] px-6 pt-3',
            isVoice ? 'pb-[420px]' : 'pb-[150px]',
          )}
        >
          {blocks.map((b) => (
            <BlockRenderer key={b.id} block={b} />
          ))}
        </div>
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------------------
 * Sub-components — kept private to this module.
 * -------------------------------------------------------------------------*/

const BlockRenderer: FC<{ block: ChatBlock }> = ({ block }) => {
  switch (block.type) {
    case 'founder':
      return <FounderBubble text={block.text} />
    case 'note':
      return <AgentNote text={block.text} />
    case 'thought':
      return <ThoughtGroup block={block} />
    case 'trends':
      return <TrendsCard />
    case 'tone':
      return <ToneCard />
    case 'posts':
      return <PostsCard block={block} />
    case 'warmup':
      return <WarmupCard block={block} />
    case 'success':
      return <SuccessCard />
    default:
      return null
  }
}

const FounderBubble: FC<{ text: string }> = ({ text }) => (
  <motion.div
    initial={{ opacity: 0, y: 6 }}
    animate={{ opacity: 1, y: 0, transition: { duration: 0.2 } }}
    className="flex justify-end"
  >
    <div className="max-w-[80%] rounded-[14px] bg-secondary px-4 py-2.5 text-[14px] leading-[1.55]">
      {text}
    </div>
  </motion.div>
)

const AgentNote: FC<{ text: string }> = ({ text }) => (
  <motion.div
    initial={{ opacity: 0, y: 6 }}
    animate={{ opacity: 1, y: 0, transition: { duration: 0.2 } }}
    className="text-[14.5px] text-foreground leading-[1.6]"
  >
    {text}
  </motion.div>
)

const ThoughtGroup: FC<{ block: ThoughtBlock }> = ({ block }) => {
  const [open, setOpen] = useState(block.status === 'running')
  const done = block.status === 'done'
  const count = block.items.length

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0, transition: { duration: 0.2 } }}
      className="overflow-hidden rounded-xl border border-[color-mix(in_oklch,var(--border)_70%,transparent)] bg-[color-mix(in_oklch,var(--card)_60%,transparent)]"
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-[14px] py-[10px] text-left"
      >
        <Layers className="size-[13px] text-muted-foreground" aria-hidden />
        <span className="flex-1 font-medium text-[13px] text-foreground">
          {done
            ? `${count}/${count} actions completed`
            : block.runningLabel || 'working…'}
        </span>
        {!done && (
          <Loader2
            className="size-[13px] animate-spin text-[var(--accent-orange)]"
            aria-hidden
          />
        )}
        <span className="text-muted-foreground">
          {open ? (
            <ChevronUp className="size-3.5" aria-hidden />
          ) : (
            <ChevronDown className="size-3.5" aria-hidden />
          )}
        </span>
      </button>
      {open && (
        <div className="flex flex-col gap-2 border-[color-mix(in_oklch,var(--border)_40%,transparent)] border-t px-4 pt-2.5 pb-3">
          {block.items.map((item) => (
            <div
              key={`${block.id}-${item.text}`}
              className="flex items-start gap-[9px]"
            >
              <span
                className={cn(
                  'mt-px flex size-4 shrink-0 items-center justify-center rounded-full',
                  item.running
                    ? 'bg-[color-mix(in_oklch,var(--accent-orange)_16%,transparent)] text-[var(--accent-orange)]'
                    : 'bg-[color-mix(in_oklch,var(--status-working,var(--accent-orange))_18%,transparent)] text-[oklch(0.4_0.13_145)]',
                )}
                aria-hidden
              >
                {item.running ? (
                  <Loader2 className="size-[11px] animate-spin" />
                ) : (
                  <Check className="size-[11px]" />
                )}
              </span>
              <span className="text-[13px] text-muted-foreground leading-[1.5]">
                {item.text}
              </span>
            </div>
          ))}
        </div>
      )}
      {block.note && (
        <div className="px-[14px] pb-3 text-[13px] text-muted-foreground italic">
          {block.note}
        </div>
      )}
    </motion.div>
  )
}

const TrendsCard: FC = () => (
  <motion.div
    initial={{ opacity: 0, y: 6 }}
    animate={{ opacity: 1, y: 0, transition: { duration: 0.2 } }}
    className="rounded-xl border border-[color-mix(in_oklch,var(--border)_70%,transparent)] bg-card px-4 py-[14px]"
  >
    <div className="mb-2.5 flex items-center gap-2 font-semibold text-[13.5px]">
      <span className="flex-1">Trends in the automation space</span>
      <span className="rounded-full bg-muted px-[7px] py-[2px] font-mono text-[10px] text-muted-foreground uppercase tracking-[0.14em]">
        {TRENDS.length} themes
      </span>
    </div>
    <ul className="m-0 list-none p-0">
      {TRENDS.map((t) => (
        <li key={t.text} className="mb-1.5 text-[13px] leading-[1.5]">
          <span
            className={cn(
              'mr-2 inline-block rounded-full px-1.5 py-px align-middle font-mono text-[9px] uppercase tracking-[0.08em]',
              t.tag === 'rising' &&
                'bg-[color-mix(in_oklch,var(--accent-orange)_14%,transparent)] text-[var(--accent-orange)]',
              t.tag === 'hot' &&
                'bg-[color-mix(in_oklch,var(--destructive)_12%,transparent)] text-destructive',
              t.tag === 'signal' &&
                'bg-[color-mix(in_oklch,var(--tint-blue-fg,#2563EB)_14%,transparent)] text-[var(--tint-blue-fg,#2563EB)]',
            )}
          >
            {t.tag}
          </span>
          {t.text}
        </li>
      ))}
    </ul>
  </motion.div>
)

const ToneCard: FC = () => (
  <motion.div
    initial={{ opacity: 0, y: 6 }}
    animate={{ opacity: 1, y: 0, transition: { duration: 0.2 } }}
    className="rounded-xl border border-[color-mix(in_oklch,var(--border)_70%,transparent)] bg-card px-4 py-[14px]"
  >
    <div className="mb-2.5 font-semibold text-[13.5px]">
      Your voice, learned
    </div>
    <ul className="m-0 flex list-none flex-col gap-[9px] p-0">
      {TONE_NOTES.map((t) => (
        <li key={t} className="flex items-start gap-2 text-[13px]">
          <Check
            className="mt-0.5 size-3 shrink-0 text-[var(--accent-orange)]"
            aria-hidden
          />
          {t}
        </li>
      ))}
    </ul>
  </motion.div>
)

const PostsCard: FC<{ block: PostsBlockT }> = ({ block }) => (
  <motion.div
    initial={{ opacity: 0, y: 6 }}
    animate={{ opacity: 1, y: 0, transition: { duration: 0.2 } }}
    className="overflow-hidden rounded-xl border border-[color-mix(in_oklch,var(--border)_70%,transparent)] bg-card"
  >
    <div className="flex items-center gap-2 border-[color-mix(in_oklch,var(--border)_50%,transparent)] border-b px-4 py-3 font-semibold text-[13.5px]">
      {POSTS.length} drafts in your voice
    </div>
    {POSTS.map((p, i) => {
      const edited = block.editedId === p.id
      const firstLine = edited ? POST2_EDIT.split('\n')[0] : p.bodyFirstLine
      return (
        <div
          key={p.id}
          className={cn(
            'border-[color-mix(in_oklch,var(--border)_35%,transparent)] border-b px-4 py-[11px] last:border-0',
            p.pinned &&
              'bg-[color-mix(in_oklch,var(--accent-orange)_5%,transparent)]',
          )}
        >
          <div className="mb-1 flex items-center gap-[9px]">
            <span className="inline-flex size-[19px] items-center justify-center rounded-md bg-secondary font-mono font-semibold text-[11px] text-muted-foreground">
              {i + 1}
            </span>
            <span className="font-semibold text-[13px]">{p.title}</span>
            {p.pinned && (
              <span className="font-semibold text-[10px] text-[var(--accent-orange)]">
                ★ recommended
              </span>
            )}
            {edited && (
              <span className="rounded-full bg-[color-mix(in_oklch,var(--accent-orange)_14%,transparent)] px-1.5 py-px font-mono text-[9px] text-[var(--accent-orange)] uppercase tracking-[0.08em]">
                edited
              </span>
            )}
          </div>
          <div className="pl-7 text-[13px] text-muted-foreground leading-[1.5]">
            {firstLine}
          </div>
        </div>
      )
    })}
  </motion.div>
)

const WarmupCard: FC<{ block: WarmupBlockT }> = ({ block }) => {
  const [open, setOpen] = useState(block.expanded)
  useEffect(() => setOpen(block.expanded), [block.expanded])
  const shown = block.done ? WARMUP.total : block.progress
  const pct = (shown / WARMUP.total) * 100

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0, transition: { duration: 0.2 } }}
      className="rounded-xl border border-[color-mix(in_oklch,var(--border)_70%,transparent)] bg-card px-4 py-[14px]"
    >
      <div className="mb-2.5 flex items-center gap-2">
        <span
          className={cn(
            'flex size-[18px] items-center justify-center rounded-full',
            block.done
              ? 'bg-[color-mix(in_oklch,var(--accent-orange)_18%,transparent)] text-[var(--accent-orange)]'
              : 'text-[var(--accent-orange)]',
          )}
          aria-hidden
        >
          {block.done ? (
            <Check className="size-[13px]" />
          ) : (
            <Loader2 className="size-[13px] animate-spin" />
          )}
        </span>
        <span className="flex-1 font-semibold text-[13.5px]">
          {block.done ? 'Warmed up LinkedIn' : 'Warming up LinkedIn…'}
        </span>
        <span className="font-mono text-[11px] text-muted-foreground">
          {shown}/{WARMUP.total}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <motion.span
          className="block h-full rounded-full bg-[var(--accent-orange)]"
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.5 }}
        />
      </div>
      <div className="mt-2 text-[12.5px] text-muted-foreground leading-[1.5]">
        Left genuine comments in your tone on {WARMUP.total} relevant posts to
        prime reach before publishing.
      </div>
      {block.done && (
        <button
          type="button"
          onClick={() => setOpen((open) => !open)}
          className="mt-2.5 inline-flex items-center gap-1 text-[12px] text-[var(--accent-orange)]"
        >
          {open ? (
            <ChevronUp className="size-[13px]" />
          ) : (
            <ChevronDown className="size-[13px]" />
          )}
          {open ? 'Hide' : 'Show'} sample comments
        </button>
      )}
      {block.done && open && (
        <div className="mt-2.5 flex flex-col gap-2.5">
          {WARMUP.samples.map((sample) => (
            <div
              key={sample.author}
              className="rounded-lg bg-secondary/60 px-3 py-2"
            >
              <div className="text-[12px] text-muted-foreground">
                on <b className="text-foreground">{sample.author}</b>: “
                {sample.post}”
              </div>
              <div className="mt-1 text-[13px] leading-[1.5]">
                {sample.comment}
              </div>
            </div>
          ))}
        </div>
      )}
    </motion.div>
  )
}

const SuccessCard: FC = () => (
  <motion.div
    initial={{ opacity: 0, y: 6 }}
    animate={{ opacity: 1, y: 0, transition: { duration: 0.2 } }}
    className="flex flex-col items-center rounded-xl border border-[color-mix(in_oklch,var(--border)_70%,transparent)] bg-card px-4 py-6 text-center"
  >
    <div className="flex size-9 items-center justify-center rounded-full bg-[color-mix(in_oklch,var(--accent-orange)_18%,transparent)] text-[var(--accent-orange)]">
      <Check className="size-[18px]" />
    </div>
    <div className="mt-3 font-semibold text-[15px]">
      Done — your post is live
    </div>
    <div className="mt-4 flex gap-6">
      {[
        { n: '5', label: 'drafts written' },
        { n: '15', label: 'posts warmed up' },
        { n: '1', label: 'published' },
      ].map((stat) => (
        <div key={stat.label} className="flex flex-col items-center">
          <b className="text-[20px] text-[var(--accent-orange)]">{stat.n}</b>
          <span className="text-[11.5px] text-muted-foreground">
            {stat.label}
          </span>
        </div>
      ))}
    </div>
    <div className="mt-4 max-w-[360px] text-[12.5px] text-muted-foreground leading-[1.5]">
      Total founder time: one voice brief. The boring work ran in a browser tab.
    </div>
  </motion.div>
)
