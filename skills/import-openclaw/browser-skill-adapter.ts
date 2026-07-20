/**
 * Rewrite OpenClaw browser-automation skill for OWeb browser_tool / Anchor.
 */
const BROWSER_ACTION_MAP: Record<string, string> = {
  status: "BROWSER_TOOL_GET_STATUS",
  tabs: "BROWSER_TOOL_LIST_TABS",
  open: "BROWSER_TOOL_NAVIGATE",
  snapshot: "BROWSER_TOOL_FETCH_WEBPAGE",
  close: "BROWSER_TOOL_CLOSE_TAB",
  act: "BROWSER_TOOL_PERFORM_ACTION",
  profiles: "BROWSER_TOOL_LIST_PROFILES",
};

export function rewriteBrowserSkillBody(body: string): string {
  let out = body;

  out = out.replace(/openclaw browser doctor/gi, "check browser_tool status");
  out = out.replace(/`browser` tool/gi, "`browser_tool` Composio toolkit");
  out = out.replace(/action\s*=\s*"(\w+)"/gi, (_m, action: string) => {
    const slug = BROWSER_ACTION_MAP[action.toLowerCase()];
    return slug
      ? `use browser_tool via \`invoke_tool\` with slug \`browser_tool__${slug}\``
      : `action="${action}" (map to browser_tool__* via search_tools)`;
  });

  out = out.replace(/profile="user"/gi, "use Anchor Browser with existing session cookies");
  out = out.replace(/refs="aria"/gi, "use browse_web or browser_tool snapshot with accessibility tree");

  return out.trim();
}

export const BROWSER_SKILL_PREREQUISITES = [
  "Connect browser_tool in Integrations or set ANCHOR_API_KEY.",
  "For logged-in flows, use Anchor Browser session or browse_web with user context.",
  "Prefer search_tools → invoke_tool with browser_tool__* slugs.",
];
