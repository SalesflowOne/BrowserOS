// Tool-name → friendly phrase used when a ToolPart sits in
// 'input-available' state on the live turn. Matches the upstream tool
// name by suffix (acpx prefixes vary), so a Klavis search tool can be
// `klavis/linear/search_issues` or just `linear/search_issues`
// depending on how the MCP server is wired. Both still resolve to
// "working in Linear".

interface ToolVerbRule {
  // Suffix matcher applied to the lowercase tool name. The first rule
  // whose suffix matches wins; order matters.
  suffix: string
  verb: string
}

const TOOL_VERB_RULES: readonly ToolVerbRule[] = [
  // BrowserOS, most common stall source in BrowserClaw. Surface what
  // the agent is doing in the browser so the founder sees it's not
  // hung.
  { suffix: 'take_snapshot', verb: 'reading the page' },
  { suffix: 'take_screenshot', verb: 'capturing a screenshot' },
  { suffix: 'new_page', verb: 'opening the page' },
  { suffix: 'navigate_page', verb: 'opening the page' },
  { suffix: 'click', verb: 'acting on the page' },
  { suffix: 'fill', verb: 'filling the form' },
  { suffix: 'press_key', verb: 'acting on the page' },
  { suffix: 'select_option', verb: 'picking an option' },
  { suffix: 'scroll', verb: 'scrolling the page' },
  { suffix: 'get_page_content', verb: 'reading the page' },
  { suffix: 'get_page_links', verb: 'scanning the links' },
  { suffix: 'list_pages', verb: 'checking open tabs' },

  // Connect-card flow (klavis nudge tool).
  {
    suffix: 'suggest_app_connection',
    verb: 'asking you to connect a service',
  },
  {
    suffix: 'connector_mcp_servers',
    verb: 'checking which apps are connected',
  },

  // Filesystem / shell: typical developer fare.
  { suffix: 'read_file', verb: 'reading the codebase' },
  { suffix: 'grep', verb: 'searching the codebase' },
  { suffix: 'glob', verb: 'searching the codebase' },
  { suffix: 'list_directory', verb: 'reading the codebase' },
  { suffix: 'write_file', verb: 'editing files' },
  { suffix: 'edit_file', verb: 'editing files' },
  { suffix: 'patch', verb: 'editing files' },
  { suffix: 'bash', verb: 'running a command' },
  { suffix: 'shell', verb: 'running a command' },
  { suffix: 'run', verb: 'running a command' },
]

// SaaS surfaces named in the playbooks. When no rule matches, check
// whether the tool name starts with a known surface and fall back to
// "working in {App}". Comes after the suffix-rule pass so specific
// tool verbs always win.
const SAAS_PREFIX_LABELS: ReadonlyArray<readonly [string, string]> = [
  ['gmail', 'Gmail'],
  ['linear', 'Linear'],
  ['github', 'GitHub'],
  ['notion', 'Notion'],
  ['slack', 'Slack'],
  ['google_calendar', 'Google Calendar'],
  ['google_docs', 'Google Docs'],
  ['google_drive', 'Google Drive'],
  ['linkedin', 'LinkedIn'],
  ['twitter', 'Twitter'],
  ['figma', 'Figma'],
  ['jira', 'Jira'],
  ['stripe', 'Stripe'],
  ['hubspot', 'HubSpot'],
  ['posthog', 'PostHog'],
  ['klavis', 'a connected app'],
]

export function verbForTool(rawToolName: string): string {
  const name = rawToolName.toLowerCase()
  for (const rule of TOOL_VERB_RULES) {
    if (name.endsWith(rule.suffix)) return rule.verb
  }
  // SaaS surface check. acpx-ai-provider namespaces MCP tools as
  // `<server>/<tool>` or `<server>/<surface>/<tool>`, so look at every
  // segment and at the bare tool name (no slash) for a known prefix.
  const segments = name.split('/')
  const bareName = segments[segments.length - 1] ?? name
  for (const [prefix, label] of SAAS_PREFIX_LABELS) {
    const hit = segments.some(
      (seg) => seg === prefix || seg.startsWith(`${prefix}_`),
    )
    if (hit || bareName.startsWith(`${prefix}_`) || bareName === prefix) {
      return `working in ${label}`
    }
  }
  // Generic fallback. Strip the server prefix so the bareword reads
  // cleanly (`using take_snapshot` rather than `using browseros/take_snapshot`).
  return `using ${bareName}`
}
