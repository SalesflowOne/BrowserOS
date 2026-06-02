import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { HireTemplate } from '../types.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = (file: string) => readFileSync(join(here, file), 'utf8').trimEnd()

export const marketer: HireTemplate = {
  id: 'marketer',
  roleTitle: 'Growth Marketer',
  roleSummary: 'Drafts copy, runs experiments, ships campaigns.',
  monogram: 'MK',
  tint: 'pink',
  defaultName: 'Maya',
  defaultTagline: 'Drafts copy, runs experiments, ships campaigns',
  defaultBio:
    'Focused on launch copy, social posts, and growth experiments. Strong sense of voice and audience.',
  capabilities: {
    tools: ['browseros'],
    skills: [
      'memory',
      'browseros',
      'internal-comms',
      'copywriting',
      'social',
      'marketing-psychology',
    ],
    saasSurfaces: ['gmail', 'twitter', 'linkedin', 'notion'],
  },
  soulBlurb: read('soul.md'),
  instructions: read('playbook.md'),
}
