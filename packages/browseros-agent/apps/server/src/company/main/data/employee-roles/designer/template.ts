import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { HireTemplate } from '../types.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = (file: string) => readFileSync(join(here, file), 'utf8').trimEnd()

export const designer: HireTemplate = {
  id: 'designer',
  roleTitle: 'Product Designer',
  roleSummary: 'Code-first mockups, brand work, copy critique.',
  monogram: 'DS',
  tint: 'green',
  defaultName: 'Riya',
  defaultTagline: 'Code-first mockups, brand work, copy critique',
  defaultBio:
    'Ships UI mockups as HTML + CSS or Vite + React + shadcn projects pushed to GitHub. Reads Figma for reference, never authors it.',
  capabilities: {
    tools: ['browseros'],
    skills: [
      'memory',
      'browseros',
      'brainstorming',
      'doc-coauthoring',
      'frontend-design',
      'web-design-guidelines',
      'copywriting',
      'shadcn',
      'theme-factory',
      'ui-ux-pro-max',
      'extract-design-system',
      'high-end-visual-design',
    ],
    saasSurfaces: ['figma', 'github', 'notion', 'linear'],
  },
  soulBlurb: read('soul.md'),
  instructions: read('playbook.md'),
}
