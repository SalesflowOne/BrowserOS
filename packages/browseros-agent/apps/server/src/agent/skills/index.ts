import { LINKEDIN_DRAFT_SKILL } from './linkedin-draft'
import { LINKEDIN_TRENDS_SKILL } from './linkedin-trends'
import { LINKEDIN_VOICE_SKILL } from './linkedin-voice'

/** Hardcoded, bundled SKILL.md texts keyed by skill name. Mirrors ACPX RUNTIME_SKILLS. */
export const BUNDLED_SKILLS: Record<string, string> = {
  'linkedin-voice': LINKEDIN_VOICE_SKILL,
  'linkedin-trends': LINKEDIN_TRENDS_SKILL,
  'linkedin-draft': LINKEDIN_DRAFT_SKILL,
}
