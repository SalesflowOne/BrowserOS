import { PAUSE_VERBS } from './employee-busy.pause-verbs'
import { verbForTool } from './employee-busy.tool-verbs'

// Per-role verb pools. Keyed off `employee.templateId` from the
// HIRE_TEMPLATES registry (developer / marketer / chief / designer /
// researcher / recruiter / blank). Each set is ~15 short verbs in
// present-participle form so "Sam is …ing" reads naturally. Concrete
// job actions over mystical ones to match BrowserClaw's workplace
// framing.
const ROLE_VERBS: Record<string, readonly string[]> = {
  developer: [
    'reading the codebase',
    'running the tests',
    'drafting the diff',
    'checking conventions',
    'reviewing the PR',
    'tracing the bug',
    'pulling the latest',
    'running the build',
    'opening a branch',
    'writing the commit message',
    'reading the recent commits',
    'checking the CI',
    'looking up the API',
    'reading the docs',
    'profiling the slow path',
  ],
  marketer: [
    'drafting the copy',
    'A/B testing the hook',
    'scanning replies',
    'scheduling the post',
    'pulling the thread',
    "reading yesterday's numbers",
    'sketching the launch',
    'rewriting the subject line',
    'shaping the angle',
    'reading the audience',
    'composing the email',
    'queuing the carousel',
    'checking impressions',
    'drafting the announcement',
    'reading the docs',
  ],
  chief: [
    'triaging the inbox',
    'drafting the follow-up',
    'checking the calendar',
    'summarising the meeting',
    'sketching the agenda',
    "pulling yesterday's notes",
    'reading the email thread',
    'drafting the brief',
    'composing the update',
    'scanning for blockers',
    'noting the action items',
    'sending the recap',
    'queuing the invites',
    'preparing the standup',
    'taking the minutes',
  ],
  designer: [
    'sketching the layout',
    'picking the palette',
    'composing the mock',
    'running the design review',
    'extracting the tokens',
    'reading the Figma',
    'shaping the hero',
    'pulling the type scale',
    'opening the editor',
    'wiring the component',
    'capturing the screenshot',
    'reviewing the rendered mock',
    'noting the spec',
    'drafting the handoff',
    'rebuilding the section',
  ],
  researcher: [
    'reading sources',
    'cross-checking',
    'compiling notes',
    'sketching the brief',
    'scanning citations',
    'pulling the quotes',
    'reading the abstract',
    'reviewing the methodology',
    'noting the gap',
    'comparing positions',
    'writing the summary',
    'composing the one-pager',
    'tracking the lineage',
    'reading the dataset',
    'verifying the claim',
  ],
  recruiter: [
    'sourcing candidates',
    'drafting the outreach',
    'scoring the panel',
    'scanning LinkedIn',
    'reviewing the resume',
    'preparing the rubric',
    'reading the role brief',
    'composing the screening note',
    'tracking the funnel',
    'pulling the interview kit',
    'noting the feedback',
    'comparing candidates',
    'writing the offer prep',
    'queuing the follow-up',
    'reading recent applications',
  ],
  blank: ['working on it', 'reading the brief', 'drafting'],
}

// Verbs that fit every role, added to the per-role pool so the
// rotation never feels narrow when a turn drags on past a few minutes.
const SHARED_VERBS = [
  'thinking it through',
  'pulling it together',
  'checking back in',
  'taking another pass',
  'noting that down',
  'reading the thread',
  'reviewing the request',
] as const

function pickFrom(pool: readonly string[]): string {
  if (pool.length === 0) return 'working on it'
  const idx = Math.floor(Math.random() * pool.length)
  return pool[idx] ?? 'working on it'
}

// Three-tier precedence (top wins):
//   1. paused          → PAUSE_VERBS  (PermissionPart pending; agent is blocked on user)
//   2. liveToolName    → verbForTool  (tool call mid-flight; surface what's happening)
//   3. role rotation   → ROLE_VERBS + SHARED_VERBS  (default, 10s cadence)
//
// Inputs are derived in ChatSurface from `live.parts` + `employee.templateId`.
export function selectVerb(input: {
  templateId: string | null
  liveToolName: string | null
  paused: boolean
}): string {
  if (input.paused) return pickFrom(PAUSE_VERBS)
  if (input.liveToolName) return verbForTool(input.liveToolName)
  const roleKey = input.templateId ?? 'blank'
  const rolePool = ROLE_VERBS[roleKey] ?? ROLE_VERBS.blank
  // ROLE_VERBS.blank is declared above; fall back to SHARED_VERBS
  // alone if for some reason that lookup misses (defensive: guards
  // against future role removals breaking the picker).
  const pool = rolePool ? [...rolePool, ...SHARED_VERBS] : [...SHARED_VERBS]
  return pickFrom(pool)
}
