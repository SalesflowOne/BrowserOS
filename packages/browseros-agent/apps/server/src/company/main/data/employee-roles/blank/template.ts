import type { HireTemplate } from '../types.js'

/**
 * Custom (`blank`) template — the user picks this when no named
 * template fits and supplies their own role + instructions via the
 * hire form's customRoleTitle + customInstructions inputs. The
 * route persists those strings to the row; the seeder writes
 * `customInstructions` into SOUL.md's `## Your role` section in
 * place of `template.instructions`.
 *
 * No soul.md / playbook.md sidecars — `soulBlurb` and
 * `instructions` are empty here intentionally.
 */
export const blank: HireTemplate = {
  id: 'blank',
  roleTitle: 'Custom employee',
  roleSummary: 'Define your own role and instructions.',
  monogram: 'CU',
  tint: 'orange',
  defaultName: '',
  defaultTagline: '',
  defaultBio: '',
  capabilities: {
    tools: ['browseros'],
    skills: ['memory', 'browseros'],
    saasSurfaces: [],
  },
  soulBlurb: '',
  instructions: '',
}
