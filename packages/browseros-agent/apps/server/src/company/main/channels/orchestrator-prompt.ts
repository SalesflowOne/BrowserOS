// Pure helpers for the channel prompt fed to the agent runtime. No
// I/O, no DB — just string composition. Two surfaces:
//   - `channelBootstrapBlock` — emitted ONCE per (channel, employee)
//     ACP session, when the orchestrator first bootstraps the
//     provider. Carries identity + roster + the one routing rule.
//     The agent's CLI session memory keeps it across subsequent turns.
//   - `channelDeltaBlock` — emitted on every turn. Carries the channel
//     activity since the speaker last spoke, formatted with `→ you`
//     markers on rows addressed at them. No separate "trigger" — the
//     delta itself is what wakes the agent.

import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { Employee } from '../../db/schema/employees.sql.js'
import type { Message } from '../../db/schema/messages.sql.js'
import { USER_PARTICIPANT_ID } from './types.js'

const USER_DISPLAY_NAME = 'user'

export async function statSoulMtime(
  workspacePath: string | null,
): Promise<number> {
  if (!workspacePath) return 0
  try {
    const s = await stat(join(workspacePath, 'SOUL.md'))
    return s.mtimeMs
  } catch {
    return 0
  }
}

/** Once-per-session block: who you are, who your teammates are, and
 *  the one routing rule (use `messageEmployee`). */
export function channelBootstrapBlock(
  channelName: string,
  topic: string | null,
  speakerId: string,
  members: Employee[],
): string {
  const self = members.find((m) => m.id === speakerId)
  const others = members.filter((m) => m.id !== speakerId)
  const lines: string[] = [
    `You are working in the #${channelName} channel${topic ? ` — ${topic}` : ''}.`,
    self ? `You are ${self.name}, the ${self.role}.` : `You are ${speakerId}.`,
    '',
  ]
  if (others.length > 0) {
    lines.push('Channel teammates:')
    for (const m of others) lines.push(`- ${formatMemberLine(m)}`)
    lines.push('')
  } else {
    lines.push('You are the only employee in this channel.')
    lines.push('')
  }
  lines.push(
    'How channels work:',
    "- Anything you say in plain text is broadcast to the channel — everyone sees it but nobody is woken to respond. It's your thinking-out-loud surface.",
    '- To send a directed message that wakes a teammate (or briefs the founder), call `messageEmployee(employee_id, body)`. Use the literal string `user` as the id to address the founder; use an `emp_…` id from the roster to wake a teammate.',
    '- You can call `messageEmployee` multiple times in one turn — each call wakes that recipient in parallel.',
    '- You cannot `messageEmployee` yourself.',
    '- Silence is a valid choice. If you have nothing useful to add, end your turn.',
    '',
    'When referring to teammates in your reply, use their name (not their id).',
  )
  return lines.join('\n')
}

/** Per-turn block: channel activity since the speaker last spoke,
 *  formatted with `→ you` markers on rows addressed at them. Always
 *  emitted; the agent's turn is the response to whatever they see. */
export function channelDeltaBlock(
  speakerId: string,
  delta: Message[],
  members: Employee[],
): string {
  if (delta.length === 0) {
    return 'No new channel activity since you last spoke. End your turn unless there is something specific you want to add.'
  }
  const lines: string[] = ['Channel activity since you last spoke:']
  for (const row of delta) {
    lines.push(formatTranscriptLine(speakerId, row, members))
  }
  lines.push('')
  lines.push(
    'Respond now: emit plain text to broadcast in the channel, or call `messageEmployee` to wake a teammate or brief the founder. End silently if nothing useful to add.',
  )
  return lines.join('\n')
}

function formatMemberLine(m: Employee): string {
  const bio = m.bio?.trim()
  const tagline = m.tagline?.trim()
  const subtitle = bio || tagline
  const subtitleSuffix = subtitle ? ` — ${subtitle}` : ''
  return `${m.name} (${m.role}), employee_id \`${m.id}\`${subtitleSuffix}`
}

function displayName(id: string, members: Employee[]): string {
  if (id === USER_PARTICIPANT_ID) return USER_DISPLAY_NAME
  const m = members.find((e) => e.id === id)
  return m?.name ?? id
}

/** Render one transcript row for the delta block. Uses names + prose.
 *  System rows (member joined / left / lead changed) carry their full
 *  text in `body`, so they render as a self-contained `(system)` line. */
export function formatTranscriptLine(
  speakerId: string,
  row: Message,
  members: Employee[],
): string {
  const body = row.body ?? ''
  if (row.kind === 'system') {
    return `(system) ${body}`
  }
  const author = displayName(row.authorId, members)
  if (row.toParticipantId === null) {
    return `${author}: ${body}`
  }
  const audience =
    row.toParticipantId === speakerId
      ? 'you'
      : displayName(row.toParticipantId, members)
  return `${author} → ${audience}: ${body}`
}
