// Matches every shape MCP tool names arrive in across runtimes: raw
// `browseros/click`, prefixed `Tool: browseros/click`, and the acpx
// flavor `mcp__browseros__click`. Boundary keeps it from matching
// arbitrary substrings (e.g. `xbrowseros_y`).
export function isBrowserosToolName(toolName: string): boolean {
  return /(?:^|[/_\s])browseros[/_]/i.test(toolName)
}

// Lifts a BrowserOS pageId out of both prose mentions
// (`page id is 8`) and acpx-flattened tool-result blobs
// (`...tool call (completed): {"pageId":6,...}`).
const PAGE_ID_RE =
  /\bpage(?:[_\-\s]*id)?\s*["']?\s*(?:is\s+|[:=]\s*)\s*[*`'"]*(\d+)/i

export function readPageIdFromText(value: string): number | null {
  const match = PAGE_ID_RE.exec(value)
  if (!match) return null
  const raw = match[1]
  if (raw === undefined) return null
  const n = Number(raw)
  return Number.isInteger(n) && n > 0 ? n : null
}

// Handles every shape browseros tool input/output values arrive in:
// already an object, a JSON-parseable string, or an acpx prose-blob
// with embedded JSON.
export function readPageIdFromAnyShape(value: unknown): number | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>
    for (const candidate of [obj.pageId, obj.page]) {
      if (
        typeof candidate === 'number' &&
        Number.isInteger(candidate) &&
        candidate > 0
      ) {
        return candidate
      }
    }
    return readPageIdFromText(JSON.stringify(value))
  }
  if (typeof value !== 'string') return null
  try {
    const fromParsed = readPageIdFromAnyShape(JSON.parse(value))
    if (fromParsed !== null) return fromParsed
  } catch {
    // not pure JSON; fall through to prose scan
  }
  return readPageIdFromText(value)
}
