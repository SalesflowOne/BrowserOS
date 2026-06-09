/**
 * Launch-demo configuration.
 *
 * The scripted New Tab demo is a hack for the launch video: the chat plays a
 * hardcoded timeline (reliable, instant) while real LinkedIn tabs fly open in
 * the background (the on-camera magic). The real streaming agent slots in later
 * by swapping `useDemoDirector` for the live hook — see AgentChat.tsx.
 *
 * Everything a demo operator needs to tweak before filming lives in this file.
 */

/** Play the scripted demo instead of the real agent stream. */
export const DEMO_MODE = true

/** Open real LinkedIn tabs during the demo. Turn off to iterate on the chat
 *  script without spawning tabs on every run. */
export const OPEN_REAL_TABS = true

/** The founder's own LinkedIn — opened during the "learn your voice" beat.
 *  Set this to the account that will be logged in during the take. */
export const DEMO_PROFILE_URL =
  'https://www.linkedin.com/in/nithinsonti/recent-activity/all/'

/** Searches opened in parallel during the "research your market" beat.
 *  ~10 real LinkedIn content searches — the viewer can't tell which (if any)
 *  feed the cards. Tune to the market you're demoing. */
export const TREND_SEARCH_KEYWORDS = [
  'AI agents',
  'browser automation',
  'AI employees',
  'marketing automation',
  'founder led marketing',
  'build in public',
  'LinkedIn growth',
  'AI SDR',
  'automate marketing',
  'content marketing AI',
]

/** Global pace multiplier. 1 = designed pace. >1 = slower. */
export const DEMO_SPEED = 1.3

/** Named, tunable durations in ms at DEMO_SPEED = 1. */
export const DEMO_TIMING = {
  bootPause: 1200,
  thinkBeforeThought: 2400,
  betweenPhases: 2800,
  thoughtRunDuration: 3400,
  draftRunDuration: 4200,
  cardRevealGap: 900,
  editRunDuration: 3000,
  beforeWarmup: 1800,
  warmupTick: 2200,
  beforePublish: 2000,
  publishGap: 2400,
  successGap: 1800,
  beforeGate: 1400,
  founderTypeStartDelay: 900,
  founderTypeCharMs: 45,
  founderSubmitDelay: 700,
} as const

export type DemoTimingKey = keyof typeof DEMO_TIMING

/** Deterministic jitter fraction for each gap. Set to 0 for exact timing. */
export const DEMO_JITTER = 0.1
export const DEMO_JITTER_SEED = 1337

/** Founder gate mode: manual operator input or scripted auto-typewriter. */
export const DEMO_FOUNDER_INPUT: 'manual' | 'auto' = 'manual'

/** Auto-submit spoken founder replies after transcription when enabled. */
export const DEMO_VOICE_AUTOSUBMIT = false
