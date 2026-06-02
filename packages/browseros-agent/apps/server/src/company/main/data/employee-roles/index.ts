// Hire-template catalogue. Each role's metadata lives in its own
// folder alongside the `soul.md` and `playbook.md` files the
// seeder writes into SOUL.md at hire. To add a new role:
//
//   1. Create a folder under `employee-roles/<id>/`.
//   2. Drop `soul.md` (the "How you think" blurb) and
//      `playbook.md` (the role-locked instructions) into it.
//   3. Write a `template.ts` that exports a `HireTemplate` —
//      mirror one of the existing roles for shape.
//   4. Import + add the export to `HIRE_TEMPLATES` below.
//
// The `capabilities` field on each template is the queryable
// matrix used by tests + (future) UI capability cards. Closed
// string-literal unions in `types.ts` keep it drift-proof — a
// role can't declare a Skill the app doesn't actually install.

import { blank } from './blank/template.js'
import { chief } from './chief/template.js'
import { designer } from './designer/template.js'
import { developer } from './developer/template.js'
import { marketer } from './marketer/template.js'
import { recruiter } from './recruiter/template.js'
import { researcher } from './researcher/template.js'
import type { HireTemplate } from './types.js'

export type { HireTemplate, TintId } from './types.js'

export const HIRE_TEMPLATES: HireTemplate[] = [
  chief,
  marketer,
  developer,
  researcher,
  recruiter,
  designer,
  blank,
]

export function findHireTemplate(id: string): HireTemplate | undefined {
  return HIRE_TEMPLATES.find((t) => t.id === id)
}
