import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { HireTemplate } from '../types.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = (file: string) => readFileSync(join(here, file), 'utf8').trimEnd()

export const researcher: HireTemplate = {
  id: 'researcher',
  roleTitle: 'Research Analyst',
  roleSummary: 'Deep web research, briefings, competitive intel.',
  monogram: 'RS',
  tint: 'teal',
  defaultName: 'Priya',
  defaultTagline: 'Deep web research, briefings, competitive intel',
  defaultBio:
    'Reads everything across the web and surfaces the signal. Writes briefs the founder can ship to a board.',
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
      'copy-editing',
      'marketing-psychology',
      'competitors',
      'customer-research',
      'competitor-profiling',
      'content-strategy',
      'product-marketing',
      'seo-audit',
      'analytics',
    ],
    saasSurfaces: [
      'notion',
      'gmail',
      'google-calendar',
      'slack',
      'linear',
      'linkedin',
      'twitter',
    ],
  },
  soulBlurb: read('soul.md'),
  instructions: read('playbook.md'),
}
