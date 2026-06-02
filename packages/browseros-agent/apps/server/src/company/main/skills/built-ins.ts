import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Static catalogue of skills the app ships in-product.
 *
 * Conventions:
 *  - `name` must equal the directory under `resources/built-in-skills/`.
 *  - Bundles are copied (not symlinked) into the workspace so the
 *    user's `~/.browserclaw/skills/<name>/` is self-contained even
 *    after the app is uninstalled.
 *  - Names are short and descriptive (no `ac-built-in-` prefix) so the
 *    agent's tool prompt reads naturally (`memory`, `browseros`). If a
 *    user already has a same-named skill from another source, the
 *    package's add() skips ours and leaves theirs in place — see the
 *    ensure routine's handling of the `skipped` result.
 */
export const BUILT_IN_SKILLS: ReadonlyArray<{
  name: string
  description: string
}> = [
  {
    name: 'memory',
    description:
      'Read and write the durable file-based memory system in the agent workspace.',
  },
  {
    name: 'browseros',
    description:
      'Drive a real Chromium browser via the BrowserOS MCP server (clicks, typing, navigation, screenshots).',
  },
  {
    name: 'app-connections',
    description:
      'Connect and use third-party SaaS apps (Gmail, Google Calendar/Docs/Drive/Sheets, Slack, GitHub, Notion, Linear, Jira, Figma, Salesforce, HubSpot, Stripe, Discord, LinkedIn, Cal.com, Resend, Asana, ClickUp, and more) via the BrowserOS Klavis Strata integration. Drives the connect → discover → execute flow and handles 401 / re-auth via the in-app Connect card.',
  },
  {
    name: 'internal-comms',
    description:
      'Draft internal communications (3P updates, newsletters, FAQ answers, status reports, leadership updates, incident reports) in a consistent voice.',
  },
  {
    name: 'doc-coauthoring',
    description:
      'Co-author documentation through a structured Context Gathering → Refinement → Reader Testing workflow. Use for PRDs, design docs, decision docs, specs, proposals.',
  },
  {
    name: 'brainstorming',
    description:
      'Clarifying-question intake before any open-ended creative work. Explores intent and requirements before producing output.',
  },
  {
    name: 'copywriting',
    description:
      'Write persuasive external marketing copy — headlines, CTAs, value propositions, taglines, and full page copy for homepage, landing, pricing, feature, and product pages.',
  },
  {
    name: 'social',
    description:
      'Create platform-aware social media content for LinkedIn, Twitter/X, Instagram, TikTok, Facebook — posts, threads, content calendars, repurposing, short-form video scripts.',
  },
  {
    name: 'marketing-psychology',
    description:
      'Apply psychological principles and mental models (anchoring, social proof, scarcity, loss aversion, framing) to marketing decisions, copy, pricing, and CRO.',
  },
  {
    name: 'frontend-design',
    description:
      'Build distinctive, production-grade frontend interfaces (web components, pages, dashboards) with intentional typography, color, motion, and layout. Avoid generic AI-styled UI.',
  },
  {
    name: 'vercel-react-best-practices',
    description:
      'Vercel Engineering performance and correctness guidelines for React and Next.js — apply when writing, reviewing, or refactoring React/Next code (data fetching, bundling, state, async patterns).',
  },
  {
    name: 'web-design-guidelines',
    description:
      'Review UI code against the Vercel Web Interface Guidelines (accessibility, interaction, visual quality). Use when auditing UI, checking accessibility, or reviewing UX.',
  },
  {
    name: 'shadcn',
    description:
      'Compose UIs from the shadcn component registry — add, search, customise, and assemble primitives for Vite/Next/React mockups. Use whenever the mock needs interaction patterns the registry already covers (forms, modals, navigation, data tables).',
  },
  {
    name: 'theme-factory',
    description:
      'Apply curated font + colour themes (10 presets, or generate on the fly) to HTML landing pages, slides, docs, and other artifacts. Use to ship a styled mockup quickly when the brief is "make it look like X" or to lock the visual direction before detailed layout work.',
  },
  {
    name: 'ui-ux-pro-max',
    description:
      'Searchable design intelligence — 50+ styles, 161 colour palettes, 57 font pairings, 99 UX guidelines across HTML/CSS, React, shadcn/ui, and other stacks. Use to plan, build, review, and fix UI/UX mocks; pairs with frontend-design for the implementation pass.',
  },
  {
    name: 'extract-design-system',
    description:
      'Reverse-engineer a public website into starter design-token files — colour scale, type system, spacing — for the project the agent is working in. Use to introspect an existing brand before mocking new surfaces so the work defers to the system instead of inventing.',
  },
  {
    name: 'high-end-visual-design',
    description:
      'Premium-aesthetic ruleset — exact fonts, spacing, shadows, card structures, and motion that make a UI feel agency-quality. Blocks the generic-AI defaults that make AI-generated designs look cheap. Use as the second review pass after frontend-design.',
  },
  {
    name: 'cold-email',
    description:
      'Write B2B cold outreach and follow-up sequences that get replies — subject lines, opening lines, body structure, CTA design, personalisation depth. Use for cold prospecting, sales-development emails, and (in recruiting) cold candidate outreach. Pair with marketing-psychology for every send.',
  },
  {
    name: 'copy-editing',
    description:
      'Edit, review, and refresh existing copy without rewriting from scratch — catches voice drift, generic phrases, throat-clearing, and the subtle drifts that make AI-shaped copy feel canned. Final-polish pass after copywriting; also handles content refreshes on outdated pages.',
  },
  {
    name: 'emails',
    description:
      'Design multi-email automated sequences and lifecycle flows — onboarding, welcome series, nurture, re-engagement, recruiting follow-ups. Carries timing, length-decay, and the value-add-then-ask cadence rules; pairs with cold-email for the first-touch and follow-up arc.',
  },
  {
    name: 'launch',
    description:
      'Plan a public release — product launch, feature announcement, beta opening, or any moment that needs pre-launch / launch-day / post-launch coordination. Also adapts to non-product launches like a new role open in recruiting (write the JD, line up sourcing channels, brief the team, post on launch day, watch week-one metrics).',
  },
  {
    name: 'referrals',
    description:
      'Design and run referral, affiliate, ambassador, or word-of-mouth programs — bonus structures, who-knows-who mapping, source attribution, viral loops. In recruiting, the multiplier for highest-quality candidates; always ask the team who they know before opening a cold search.',
  },
  {
    name: 'competitors',
    description:
      'Frame the company against alternatives — us-vs-them comparison pages, alternative pages, battle cards. In recruiting, the lens for the "why our company vs your current employer" conversation; surface honest trade-offs before the candidate asks.',
  },
  {
    name: 'marketing-tools',
    description:
      'Vendored registry of third-party marketing / sales / growth SaaS tools. Reference shelf used by other skills (cold-email, emails, launch, referrals) when they cite a concrete vendor; the agent follows the link into integrations/<name>.md for the per-tool guide. Not used directly by any role; loaded so the cross-skill references resolve at runtime.',
  },
  {
    name: 'customer-research',
    description:
      "Voice-of-customer work — jobs-to-be-done interviews, problem-validation tests, customer-development surveys, segment definition. Carries question taxonomies (open vs leading, signal vs noise), synthesis frames (theme clusters, severity scoring), and participant-comms hygiene (consent, anonymity, follow-up). The researcher's workhorse for any quoted-customer brief.",
  },
  {
    name: 'competitor-profiling',
    description:
      'Deep dossier-building from competitor URLs — feature matrices, pricing, positioning, target customer, GTM motion, public posture. Produces the intel; pair with `competitors` for the downstream us-vs-them framing.',
  },
  {
    name: 'content-strategy',
    description:
      'Topic landscape research, content audits, angle qualification, content-calendar planning input. Answers "what topics matter, what angles are crowded, what\'s our authentic lane" — informs the marketer rather than executing the campaign.',
  },
  {
    name: 'product-marketing',
    description:
      'Positioning research, ICP definition, value-prop testing, messaging hierarchy. Pair with `customer-research` for the customer-language layer — the words the ICP actually uses to describe their problem.',
  },
  {
    name: 'seo-audit',
    description:
      "Performance baseline research — where the company currently ranks, on-page issues, what's working, the gap between intended target and current reality. The foundation any SEO recommendation should sit on; researcher produces it, marketer / developer acts on it.",
  },
  {
    name: 'analytics',
    description:
      'Measurement-vocab + instrumentation review — what\'s tracked, what\'s the funnel, what\'s the cohort cut, what\'s the attribution model. Read lens for "why did metric X drop"; pair with `customer-research` for the "why" follow-up after a metric move.',
  },
]

export function getBuiltInSkillsRoot(): string {
  // Server runtime: the bundles are copied alongside the company module
  // at `src/company/resources/built-in-skills/`. A packaged build can
  // override the location via COMPANY_BUILT_IN_SKILLS_DIR.
  // biome-ignore lint/style/noProcessEnv: optional packaged-build override for the resources path
  const override = process.env.COMPANY_BUILT_IN_SKILLS_DIR
  if (override && override.length > 0) return override
  // import.meta.url points at src/company/skills/built-ins.ts; walk up to
  // src/company/ and into resources/.
  const here = path.dirname(fileURLToPath(import.meta.url))
  return path.resolve(here, '..', 'resources', 'built-in-skills')
}
