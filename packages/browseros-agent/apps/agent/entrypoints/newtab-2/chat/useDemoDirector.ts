import { useCallback, useEffect, useState } from 'react'
import { sentry } from '@/lib/sentry/sentry'
import type { ChatBlock, ThoughtItem } from './chat-screen.types'
import { openProfileTab, openTrendTabs } from './demo-tabs'

export interface DemoDirector {
  blocks: ChatBlock[]
  appendFounder: (text: string) => void
}

const nextId = (() => {
  let n = 0
  return () => `demo-${++n}`
})()

const FOUNDER_BRIEF =
  'Post about how AI agents automate the boring work — like marketing. Audience: founders & builders. My exact voice. Draft 5, warm up the account, then publish my pick.'

const append =
  (...add: ChatBlock[]) =>
  (blocks: ChatBlock[]) => [...blocks, ...add]

const finishThought =
  (items: ThoughtItem[]) =>
  (blocks: ChatBlock[]): ChatBlock[] =>
    blocks.map((block) =>
      block.type === 'thought' && block.status === 'running'
        ? {
            ...block,
            status: 'done' as const,
            runningLabel: undefined,
            items,
          }
        : block,
    )

const updateWarmup =
  (patch: Partial<{ progress: number; done: boolean; expanded: boolean }>) =>
  (blocks: ChatBlock[]): ChatBlock[] =>
    blocks.map((block) =>
      block.type === 'warmup' ? { ...block, ...patch } : block,
    )

type DemoStep = {
  at: number
  apply?: (blocks: ChatBlock[]) => ChatBlock[]
  effect?: () => Promise<void>
}

const trendsDoneItems: ThoughtItem[] = [
  { text: 'Opened linkedin.com — feed loaded' },
  { text: 'Scanned 40+ recent posts in your space' },
  { text: 'Pulled 6 recurring themes and a clear open lane' },
]

const toneDoneItems: ThoughtItem[] = [
  { text: 'Opened your LinkedIn profile' },
  { text: 'Read your last 20 posts and comments' },
  { text: 'Modeled your voice: direct, lowercase, specific, no hype' },
]

const draftDoneItems: ThoughtItem[] = [
  { text: 'Wrote 5 drafts in your voice' },
  { text: 'Created a Google Doc and saved them there' },
]

const buildSteps = (): DemoStep[] => [
  {
    at: 600,
    apply: append({
      type: 'thought',
      id: nextId(),
      status: 'done',
      note: "Here's my plan. Starting with research.",
      items: [
        { text: 'Read the brief and pulled context from your voice notes' },
        {
          text: 'Broke this into 4 steps: research trends → learn your tone → draft 5 → warm up & publish',
        },
      ],
    }),
  },
  {
    at: 2000,
    apply: append({
      type: 'thought',
      id: nextId(),
      status: 'running',
      runningLabel: 'Extracting trends',
      items: [
        { text: 'Opened linkedin.com — feed loaded' },
        { text: 'Reading the automation & AI-agents space', running: true },
      ],
    }),
    effect: openTrendTabs,
  },
  {
    at: 4600,
    apply: (blocks) =>
      append(
        { type: 'trends', id: nextId() },
        {
          type: 'note',
          id: nextId(),
          text: "Clear lane: 'boring work first', brutally specific, no emoji. Now I'll learn your voice.",
        },
      )(finishThought(trendsDoneItems)(blocks)),
  },
  {
    at: 6400,
    apply: append({
      type: 'thought',
      id: nextId(),
      status: 'running',
      runningLabel: 'Extracting tone & style',
      items: [
        { text: 'Opened your LinkedIn profile' },
        { text: 'Reading your last 20 posts and comments', running: true },
      ],
    }),
    effect: openProfileTab,
  },
  {
    at: 9000,
    apply: (blocks) =>
      append(
        { type: 'tone', id: nextId() },
        {
          type: 'note',
          id: nextId(),
          text: 'Locked your voice. Writing five drafts now.',
        },
      )(finishThought(toneDoneItems)(blocks)),
  },
  {
    at: 10600,
    apply: append({
      type: 'thought',
      id: nextId(),
      status: 'running',
      runningLabel: 'Drafting 5 posts',
      items: [
        { text: 'Writing hooks against the open lane' },
        { text: 'Matching your sentence rhythm and CTAs', running: true },
      ],
    }),
  },
  {
    at: 13400,
    apply: (blocks) =>
      append(
        {
          type: 'note',
          id: nextId(),
          text: 'These are your 5 posts — draft 1 is my pick for the awareness goal. Want any changes, or should I publish?',
        },
        { type: 'posts', id: nextId() },
      )(finishThought(draftDoneItems)(blocks)),
  },
  {
    at: 15400,
    apply: append({
      type: 'founder',
      id: nextId(),
      text: 'Make draft 2 punchier — tighter hook, and cut anything that sounds salesy.',
    }),
  },
  {
    at: 17200,
    apply: append(
      {
        type: 'note',
        id: nextId(),
        text: 'Tightened draft 2 — sharper first line, dropped the salesy close. Updated the doc too.',
      },
      { type: 'posts', id: nextId(), editedId: 'p2' },
    ),
  },
  {
    at: 19000,
    apply: append({
      type: 'founder',
      id: nextId(),
      text: "Perfect. Let's publish draft 1.",
    }),
  },
  {
    at: 20400,
    apply: append(
      {
        type: 'note',
        id: nextId(),
        text: "Before I publish, I'll warm up your account — genuine comments on 15 relevant posts in your voice. Lifts early reach.",
      },
      {
        type: 'warmup',
        id: nextId(),
        progress: 0,
        done: false,
        expanded: false,
      },
    ),
  },
  {
    at: 22000,
    apply: updateWarmup({ progress: 8 }),
  },
  {
    at: 23400,
    apply: updateWarmup({ progress: 15, done: true, expanded: true }),
  },
  {
    at: 25000,
    apply: append({
      type: 'note',
      id: nextId(),
      text: 'Warm-up done. Publishing draft 1 now.',
    }),
  },
  {
    at: 26600,
    apply: append({
      type: 'note',
      id: nextId(),
      text: "Published. It's live and already getting reactions.",
    }),
  },
  {
    at: 28000,
    apply: append({ type: 'success', id: nextId() }),
  },
]

export function useDemoDirector(
  initialMessage: string | undefined,
  enabled: boolean,
): DemoDirector {
  const [blocks, setBlocks] = useState<ChatBlock[]>(() => [
    {
      type: 'founder',
      id: nextId(),
      text: initialMessage?.trim() ? initialMessage.trim() : FOUNDER_BRIEF,
    },
  ])

  const appendFounder = useCallback((text: string) => {
    const trimmed = text.trim()
    if (!trimmed) return
    setBlocks((blocks) => [
      ...blocks,
      { type: 'founder', id: nextId(), text: trimmed },
    ])
  }, [])

  useEffect(() => {
    if (!enabled) return
    const timers: ReturnType<typeof setTimeout>[] = []
    const steps = buildSteps()
    for (const step of steps) {
      timers.push(
        setTimeout(() => {
          if (step.apply) setBlocks(step.apply)
          if (step.effect) {
            Promise.resolve(step.effect()).catch((err) =>
              sentry.captureException(err, {
                extra: { message: 'demo-director effect failed' },
              }),
            )
          }
        }, step.at),
      )
    }
    return () => {
      for (const timer of timers) clearTimeout(timer)
    }
  }, [enabled])

  return { blocks, appendFounder }
}
