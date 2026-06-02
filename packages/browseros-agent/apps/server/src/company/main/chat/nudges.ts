// Tool-name matcher for "nudge" tools — used by StreamTranslator to
// drop the upstream tool.call.proposed and tool.result events so the
// renderer doesn't show a generic tool block next to the connect
// card. The connect card itself comes from `mcp.connect_required`,
// which the nudge MCP tool handler (main/routes/nudge-mcp.ts) emits
// directly into the thread's EventSink.
//
// Accepts both the unprefixed `suggest_app_connection` and any
// namespace-prefixed form. acpx-ai-provider stringifies the runtime's
// tool title (typically `"Tool: <server>/<name>"`) into the `toolName`
// field; the suffix check tolerates that prefix.

export function isNudgeToolName(toolName: string): boolean {
  return (
    toolName === 'suggest_app_connection' ||
    toolName.endsWith('/suggest_app_connection')
  )
}
