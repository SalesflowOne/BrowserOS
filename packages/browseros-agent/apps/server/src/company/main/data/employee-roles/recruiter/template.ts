import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { HireTemplate } from '../types.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = (file: string) => readFileSync(join(here, file), 'utf8').trimEnd()

export const recruiter: HireTemplate = {
  id: 'recruiter',
  roleTitle: 'Talent Sourcer',
  roleSummary: 'Sources candidates, drafts outreach, schedules interviews.',
  monogram: 'RC',
  tint: 'purple',
  defaultName: 'Jordan',
  defaultTagline: 'Sources candidates, drafts outreach, schedules interviews',
  defaultBio:
    'Owns the top of the recruiting funnel. Personalises outreach, runs the pipeline, never ghosts.',
  capabilities: {
    tools: ['browseros'],
    skills: [
      'memory',
      'browseros',
      'app-connections',
      'brainstorming',
      'doc-coauthoring',
      'internal-comms',
      'copywriting',
      'marketing-psychology',
      'cold-email',
      'emails',
      'copy-editing',
      'competitors',
      'referrals',
      'launch',
    ],
    saasSurfaces: [
      'linkedin',
      'gmail',
      'google-calendar',
      'github',
      'twitter',
      'notion',
      'slack',
      'linear',
    ],
  },
  soulBlurb: read('soul.md'),
  instructions: read('playbook.md'),
}
