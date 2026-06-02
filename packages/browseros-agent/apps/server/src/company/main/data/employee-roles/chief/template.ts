import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { HireTemplate } from '../types.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = (file: string) => readFileSync(join(here, file), 'utf8').trimEnd()

export const chief: HireTemplate = {
  id: 'chief',
  roleTitle: 'Chief of Staff',
  roleSummary: 'Runs the executive surface — calendar, email, follow-ups.',
  monogram: 'CS',
  tint: 'orange',
  defaultName: 'Alex',
  defaultTagline: 'Calendar, email, follow-ups, the whole executive surface',
  defaultBio:
    "Acts as the founder's right hand across email, calendar, and meeting notes. Drafts replies, schedules meetings, owns follow-ups.",
  capabilities: {
    tools: ['browseros'],
    skills: [
      'memory',
      'browseros',
      'internal-comms',
      'doc-coauthoring',
      'brainstorming',
    ],
    saasSurfaces: ['gmail', 'google-calendar', 'slack', 'notion', 'linear'],
  },
  soulBlurb: read('soul.md'),
  instructions: read('playbook.md'),
}
