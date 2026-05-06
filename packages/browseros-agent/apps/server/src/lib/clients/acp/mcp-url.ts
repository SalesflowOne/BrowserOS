/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * The URL the BrowserOS server's own MCP route is reachable at.
 *
 * The ACP provider category points its `acpx-ai-provider` runtime at
 * this URL so locally-spawned ACP agents (Claude Code, Codex, Gemini,
 * …) discover the full BrowserOS browser-tool surface natively over
 * MCP, without requiring host-side AI SDK tool injection (which the
 * acpx-ai-provider doesn't support today).
 *
 * Set once during `createHttpServer` after the listen port is known;
 * read lazily by the provider factory at chat-turn construction time.
 */

let cached: string | null = null

export function setBrowserOSMcpUrl(url: string): void {
  cached = url
}

/**
 * Returns the configured URL, or a localhost fallback derived from the
 * default port. The fallback exists so unit tests / one-off invocations
 * that bypass `createHttpServer` still get a usable string instead of
 * a hard error — they simply won't reach a real MCP unless the server
 * is also running.
 */
export function getBrowserOSMcpUrl(): string {
  if (cached) return cached
  return 'http://127.0.0.1:9100/mcp'
}
