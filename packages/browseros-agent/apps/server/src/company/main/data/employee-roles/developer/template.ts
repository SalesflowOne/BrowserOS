import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { HireTemplate } from '../types.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = (file: string) => readFileSync(join(here, file), 'utf8').trimEnd()

export const developer: HireTemplate = {
  id: 'developer',
  roleTitle: 'Software Engineer',
  roleSummary: 'Reads the codebase, opens PRs, runs tests.',
  monogram: 'DV',
  tint: 'blue',
  defaultName: 'Sam',
  defaultTagline: 'Reads the codebase, opens PRs, runs tests',
  defaultBio:
    'Pairs with the founder on the codebase. Reviews PRs, writes patches, owns the test suite.',
  capabilities: {
    tools: ['browseros'],
    skills: [
      'memory',
      'browseros',
      'brainstorming',
      'doc-coauthoring',
      'frontend-design',
      'vercel-react-best-practices',
      'web-design-guidelines',
    ],
    saasSurfaces: ['github', 'linear'],
  },
  soulBlurb: read('soul.md'),
  instructions: read('playbook.md'),
}
