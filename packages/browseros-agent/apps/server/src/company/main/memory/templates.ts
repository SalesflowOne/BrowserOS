// Pure data + builders for the per-employee files seeded at hire
// time. No I/O. Two file shapes live here:
//
//   1. SOUL.md — the agent's persona. Identity line, role-specific
//      "How you think" blurb, founder-provided bio, and the
//      role-locked playbook (template instructions or
//      customInstructions). This is the *only* place the persona
//      lives — the agent-aware instruction file no longer
//      duplicates it.
//   2. The agent-aware instruction file (CLAUDE.md / AGENTS.md /
//      GEMINI.md, picked by `instructionFilenameFor`) — carries
//      only the BrowserClaw-wide protocol (where memory lives,
//      first-reply read order, the cross-cutting safety rule).
//      Kept lean on purpose: when the persona was inlined here
//      the agent could see its identity without ever opening
//      SOUL.md, treated the "Read ./SOUL.md" step as redundant,
//      and skipped it — eroding the protocol. By making SOUL.md
//      the sole source of identity, the read step becomes
//      load-bearing.

import type { Employee } from '../../db/schema/employees.sql.js'
import type { HireTemplate } from '../data/employee-roles/index.js'

/**
 * Picks the filename each agent runtime reads from its cwd:
 *
 *   claude → CLAUDE.md
 *   codex  → AGENTS.md
 *   gemini → GEMINI.md
 *
 * Unknown / future agent kinds fall back to AGENTS.md, which is
 * the de-facto cross-runtime default.
 */
export function instructionFilenameFor(agentKind: string): string {
  switch (agentKind) {
    case 'claude':
      return 'CLAUDE.md'
    case 'codex':
      return 'AGENTS.md'
    case 'gemini':
      return 'GEMINI.md'
    default:
      return 'AGENTS.md'
  }
}

/**
 * Resolves the role-locked playbook body for an employee. For named
 * templates the body comes from `template.instructions` (loaded
 * from the role's `playbook.md` sidecar at module import time).
 * For the Custom (`blank`) template it comes from the row's
 * `custom_instructions` column. Pre-template rows return "".
 */
function resolveRoleInstructions(
  employee: Employee,
  template: HireTemplate | undefined,
): string {
  if (employee.templateId === 'blank') {
    return employee.customInstructions?.trim() ?? ''
  }
  return template?.instructions.trim() ?? ''
}

/**
 * Build a SOUL.md from an employee row. Composes: a "You are X, the Y."
 * line, the role-specific "How you think" blurb (from the template's
 * `soul.md` sidecar), the founder-provided bio, and the role-locked
 * playbook (template `instructions` or `customInstructions`).
 * SOUL.md is the sole source of persona + role; the agent's
 * `CLAUDE.md` / `AGENTS.md` / `GEMINI.md` only carries the protocol.
 */
export function buildSoulMd(
  employee: Employee,
  template?: HireTemplate,
): string {
  const lines: string[] = [
    `# You are ${employee.name}`,
    '',
    `You are ${employee.name}, the ${employee.role}.`,
  ]
  const tagline = employee.tagline?.trim()
  if (tagline) {
    lines.push('', `> ${tagline}`)
  }
  const blurb = template?.soulBlurb?.trim()
  if (blurb) {
    lines.push('', blurb)
  }
  const bio = employee.bio?.trim()
  if (bio) {
    lines.push('', '## Personal context', '', bio)
  }
  const role = resolveRoleInstructions(employee, template)
  if (role) {
    lines.push('', '## Your role', '', role)
  }
  // Trailing newline — the agent reads this as a section of a larger prompt
  // and the join helper expects sections to be self-terminating.
  lines.push('')
  return lines.join('\n')
}

/**
 * MEMORY.md is seeded as a zero-byte file. The globally-installed
 * `memory` skill teaches the structure (Preferences / Where things
 * live / Recent additions) and the agent writes it lazily as facts
 * accumulate.
 */
export const MEMORY_MD_INITIAL = ''

/**
 * Section 1 (and only section) of the instruction file — the
 * BrowserClaw-wide protocol. Deliberately small. Anything the
 * runtime, cwd, or the installed skills already deliver has been
 * removed: skill discovery is the runtime's job, memory hygiene
 * lives in the `memory` skill's SKILL.md, the agent knows its cwd
 * from the runtime. What stays is the stuff the agent can't
 * derive from anywhere else — where its persistent state lives,
 * the first-reply read order, and the cross-cutting irreversible-
 * side-effect rule.
 *
 * Workspace-path interpolation kept on purpose: the protocol's
 * "your identity lives only here: <path>" line is what anchors
 * the agent to write to ./life/ instead of any default state dir
 * its runtime might prefer.
 */
function buildDefaultProtocol(workspacePath: string): string {
  return `# BrowserClaw Protocol

You are running inside BrowserClaw as an employee. Your identity, memory, and life context live in this workspace — and only here:

  ${workspacePath}

Reference your own files with relative paths: \`./SOUL.md\`, \`./MEMORY.md\`, \`./life/...\`.

## Before your first reply in a new conversation

1. Read \`./SOUL.md\` — your identity, voice, boundaries, and the role-locked playbook you operate by.
2. Read \`./MEMORY.md\` — durable preferences and pointers into \`./life/\`.

Continuation turns within an open thread: rely on existing context; don't re-read.

## Core discipline

Confirm before any irreversible external side-effect (send, post, buy, delete, transfer).

## Naming the conversation

On your very first reply in a new conversation, you MUST call \`browserclaw/set_thread_title\` with a short 3-6 word title that summarises the user's first message. Do this BEFORE any other tool call or visible text. The title appears in the user's thread sidebar — make it scannable (Title Case, no trailing punctuation, no emoji). Examples: "Calendar meetings lookup", "Refactor login flow", "Draft launch tweet". This is non-optional for the first reply. The tool is idempotent — it rejects subsequent calls once the thread has a non-default title, so you cannot overwrite a user-set name.

## Announcing what you shipped

When you finish or ship something significant (a merged PR, a published post, a completed brief, a closed incident, a sent campaign), call \`browserclaw/post_announcement\` ONCE with a short \`title\` and a 2-4 sentence \`body\` explaining what you did and the outcome. Both fields accept GitHub-flavored markdown: use \`**bold**\` for emphasis, \`inline code\` for identifiers, bulleted lists when listing things, and ALWAYS link to the source artefact with \`[descriptive label](https://...)\` (PR, tweet, dashboard, doc, etc.). Keep the title to one line of inline formatting; save lists and code blocks for the body. Post ONLY for completed work. Do not post to acknowledge a task you accepted, and do not post when answering the founder's questions; reply in chat for that. One thing shipped = one announcement.`
}

/**
 * The instruction file the agent runtime auto-loads from cwd —
 * carries the BrowserClaw-wide protocol only. Persona + role
 * live in SOUL.md (see `buildSoulMd`); duplicating them here used
 * to make the agent skip the "Read ./SOUL.md" step as redundant.
 */
export function buildInstructionFile(employee: Employee): string {
  if (!employee.workspacePath) {
    // Invariant: the seeder bails when workspacePath is null, so this
    // path is unreachable in practice. Throwing surfaces the
    // programming error loudly instead of producing a broken file.
    throw new Error('buildInstructionFile called with no workspacePath')
  }
  return `${buildDefaultProtocol(employee.workspacePath)}\n`
}
