import type { VoiceTurn } from './chat-screen.types'

export const VOICE_TURNS: VoiceTurn[] = [
  { who: 'agent', text: 'What do you want to post about today?' },
  {
    who: 'founder',
    text: "I want to post about how AI agents can automate the boring parts of running a company, marketing being the obvious one. We're BrowserOS.",
  },
  {
    who: 'agent',
    text: 'Got it. Who are we talking to, other founders, or a broader tech crowd?',
  },
  {
    who: 'founder',
    text: 'Founders and early-stage builders, mostly. People who feel the marketing grind.',
  },
  { who: 'agent', text: 'And the goal of the post, signups, or awareness?' },
  {
    who: 'founder',
    text: 'Awareness, with a soft nudge to try BrowserOS. Nothing salesy.',
  },
  {
    who: 'agent',
    text: 'Last thing, should I match your usual LinkedIn voice, or try something new?',
  },
  {
    who: 'founder',
    text: 'Match my tone exactly. Direct, no hype, no emoji.',
  },
  {
    who: 'agent',
    text: "Perfect. I'll study the automation space, learn your voice from your last posts, and draft five. Kicking off now.",
  },
]

export interface TrendFinding {
  tag: 'rising' | 'hot' | 'signal'
  text: string
}

export const TRENDS: TrendFinding[] = [
  {
    tag: 'rising',
    text: '"AI employees" reframed as workflows, not chatbots. Posts that name a specific boring task outperform abstract ones 4:1.',
  },
  {
    tag: 'hot',
    text: 'Founders sharing what they personally stopped doing get 3x the saves of feature announcements.',
  },
  {
    tag: 'rising',
    text: '"Automate the boring" angle is crowded. The winning version is brutally specific (one task, one number).',
  },
  {
    tag: 'signal',
    text: 'Short, punchy first lines with a concrete claim beat "thought-leader" intros. No emoji on top performers.',
  },
  {
    tag: 'signal',
    text: 'Marketing-ops automation is under-discussed vs eng automation. Open lane for a founder POV.',
  },
]

export const TONE_NOTES = [
  'Direct, declarative sentences. No exclamation marks.',
  'Lowercase product references, specific numbers in-line.',
  'Opens with a claim or a confession, never a question.',
  'Short paragraphs, lots of line breaks.',
  'No emoji. No "excited to share". Ends on a small, dry CTA.',
]

export interface MockPost {
  id: string
  title: string
  pinned?: boolean
  bodyFirstLine: string
  body?: string
}

export const POSTS: MockPost[] = [
  {
    id: 'p1',
    title: 'The marketing one',
    pinned: true,
    bodyFirstLine: 'I stopped writing my own LinkedIn posts three weeks ago.',
    body: "I stopped writing my own LinkedIn posts three weeks ago.\n\nNot because I'm lazy — because it was the most automatable thing I did all week. Research the space, match my voice, draft, schedule. None of it needed me. It needed taste, and taste can be specified.\n\nSo I gave the job to an agent running inside its own browser. It reads my last 20 posts, studies what's working in our space, drafts five, and waits for me to approve. I still pick the take. It does the grind.\n\nThis post was one of the five.\n\nThat's the whole pitch for BrowserOS — your boring work, run by an employee that lives in a browser tab.",
  },
  {
    id: 'p2',
    title: 'The punchy hook',
    bodyFirstLine: 'Marketing is the most automatable job at most startups.',
    body: 'Marketing is the most automatable job at most startups.\n\nNobody says it because it feels like admitting the work doesn\'t matter. It does. But "matters" and "needs a human every time" are different things.\n\nWe handed ours to an agent. It researches, drafts in my voice, and warms up the account before posting. I approve or kill. Reach is up, my Sundays are back.',
  },
  {
    id: 'p3',
    title: 'The contrarian take',
    bodyFirstLine:
      'Hot take: most "AI employee" demos are fake because they automate the impressive work and leave you the boring work.',
    body: 'Hot take: most "AI employee" demos are fake because they automate the impressive work and leave you the boring work.\n\nIt should be the other way around.\n\nThe boring work — the LinkedIn cadence, the inbox triage, the standup notes — is exactly what an agent should own. That\'s what we built BrowserOS for. The model picks the verbs. The browser enforces what it\'s allowed to touch.',
  },
  {
    id: 'p4',
    title: 'The story',
    bodyFirstLine:
      'A founder I know spends four hours a week on LinkedIn. Researching, writing, second-guessing, scheduling.',
    body: "A founder I know spends four hours a week on LinkedIn. Researching, writing, second-guessing, scheduling.\n\nFour hours. On a channel that isn't his product.\n\nWe pointed an agent at it. Same voice, same judgment calls surfaced to him, a fraction of the time. He reviews drafts on his phone between meetings now.\n\nThe boring parts of growth are the most automatable. Start there.",
  },
  {
    id: 'p5',
    title: 'The builder note',
    bodyFirstLine:
      'We give every agent its own browser profile, so it can only touch what you scoped.',
    body: "We give every agent its own browser profile, so it can only touch what you scoped.\n\nThat sounds like a security detail. It's actually why automating marketing finally works — the agent can log into LinkedIn as a real session, read the feed, comment, and post, without you handing over the keys to everything else.\n\nScope is the feature. The boring work is the use case.",
  },
]

export const POST2_EDIT =
  "Marketing is the most automatable job at your startup. Nobody says it out loud.\n\nWe handed ours to an agent — it researches the space, drafts in my exact voice, warms up the account, then posts. I just approve or kill.\n\nReach is up. My Sundays are back. That's BrowserOS."

export interface Founder {
  name: string
  first: string
  handle: string
  title: string
  sub: string
  followers: string
  initials: string
}

export const FOUNDER: Founder = {
  name: 'Nithin Venkat',
  first: 'Nithin',
  handle: 'nithin',
  title: 'Founder & CEO at BrowserOS',
  sub: 'Building the browser that runs your AI employees · San Francisco',
  followers: '11,482',
  initials: 'NV',
}

export interface WarmupSample {
  author: string
  role: string
  post: string
  comment: string
}

export const WARMUP: { total: number; samples: WarmupSample[] } = {
  total: 15,
  samples: [
    {
      author: 'Priya Nair',
      role: 'Founder, Loophole AI',
      post: 'Just shipped our agent framework v2 — 10x faster tool calls.',
      comment:
        'The tool-call speed matters less than where the agent is allowed to run. Scoped profiles fixed this for us — happy to compare notes.',
    },
    {
      author: 'Marcus Lee',
      role: 'Building in public · ex-Stripe',
      post: 'Spent my whole Sunday writing content. There has to be a better way.',
      comment:
        'There is — give it to an agent that knows your voice. I stopped writing my own posts a few weeks ago and reach went up, not down.',
    },
    {
      author: 'Dana Whitfield',
      role: 'Head of Growth, Northwind',
      post: 'Marketing automation tools all feel the same. Templates, not judgment.',
      comment:
        'Templates are the problem. The unlock is an agent that reads your last 20 posts and matches the judgment, not a fill-in-the-blank.',
    },
    {
      author: 'Sam Okoro',
      role: 'Founder, Relay',
      post: 'AI employees are overhyped. Change my mind.',
      comment:
        "Most demos automate the impressive work and leave you the boring work. Flip it — give it the LinkedIn grind first. That's the real test.",
    },
  ],
}

export const WARMUP_TOTAL = WARMUP.total
