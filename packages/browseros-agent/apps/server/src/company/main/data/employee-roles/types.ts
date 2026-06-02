// Hire-template types + the closed string-literal unions that
// describe each role's capability matrix.
//
// Closed unions for Tool / Skill so a role declaring something the
// app doesn't ship fails at typecheck — catches the drift case
// where a role's playbook references a skill that hasn't been
// added to BUILT_IN_SKILLS yet.
//
// SaasSurface is intentionally a smaller curated list — these are
// the apps the agent reaches through BrowserOS today. Add a new
// surface here when the playbook for any role names it.

export type TintId = 'orange' | 'blue' | 'green' | 'purple' | 'pink' | 'teal'

/** MCP servers the role uses directly. Mirrors the names in
 *  `apps/desktop/src/main/chat/agent-mcp-servers.ts`. */
export type Tool = 'browseros'

/** Skills the role leans on. Must be a subset of BUILT_IN_SKILLS
 *  in `apps/desktop/src/main/skills/built-ins.ts` — adding a skill
 *  here without adding it there means the role's playbook tells
 *  the agent to use a tool that isn't loaded. */
export type Skill =
  | 'memory'
  | 'browseros'
  | 'app-connections'
  | 'internal-comms'
  | 'doc-coauthoring'
  | 'brainstorming'
  | 'copywriting'
  | 'social'
  | 'marketing-psychology'
  | 'frontend-design'
  | 'vercel-react-best-practices'
  | 'web-design-guidelines'
  | 'shadcn'
  | 'theme-factory'
  | 'ui-ux-pro-max'
  | 'extract-design-system'
  | 'high-end-visual-design'
  | 'cold-email'
  | 'copy-editing'
  | 'emails'
  | 'launch'
  | 'referrals'
  | 'competitors'
  | 'customer-research'
  | 'competitor-profiling'
  | 'content-strategy'
  | 'product-marketing'
  | 'seo-audit'
  | 'analytics'

/** SaaS apps the role typically operates on through BrowserOS.
 *  Used by the playbook + (future) UI capability cards. */
export type SaasSurface =
  | 'gmail'
  | 'google-calendar'
  | 'slack'
  | 'notion'
  | 'linear'
  | 'github'
  | 'twitter'
  | 'linkedin'
  | 'figma'

export interface RoleCapabilities {
  tools: Tool[]
  skills: Skill[]
  saasSurfaces: SaasSurface[]
}

/** Hire template — the immutable role identity plus the
 *  personality-default and capability metadata that drives the
 *  hire form, the SOUL.md seeder, and the API surface returned
 *  to the renderer. */
export interface HireTemplate {
  id: string
  /** Job title — written verbatim into the employee row and the
   *  SOUL.md persona header. Locked at hire for named templates;
   *  the Custom (`blank`) template exposes a `customRoleTitle`
   *  input instead. */
  roleTitle: string
  /** One-line summary for the template-picker card. */
  roleSummary: string
  monogram: string
  tint: TintId

  /** Hire-form defaults — the user can edit any of these. */
  defaultName: string
  defaultTagline: string
  defaultBio: string

  /** Queryable capability matrix. Used additively today —
   *  documentation that the playbook also mentions. */
  capabilities: RoleCapabilities

  /** Loaded from the sibling `soul.md` file. Renders into
   *  SOUL.md's "How you think" block. Empty for blank. */
  soulBlurb: string

  /** Loaded from the sibling `playbook.md` file. Renders into
   *  SOUL.md's "## Your role" section. Empty for blank — the
   *  user supplies role text at hire via `customInstructions`. */
  instructions: string
}
