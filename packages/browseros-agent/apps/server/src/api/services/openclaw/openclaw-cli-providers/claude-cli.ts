/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type {
  OpenClawCliProvider,
  OpenClawCliProviderAuthStatus,
} from './types'

const CLAUDE_CLI_MODELS = [
  'claude-sonnet-4-6',
  'claude-opus-4-6',
  'claude-haiku-4-5',
] as const

interface ClaudeAuthStatusPayload {
  loggedIn?: boolean
  email?: string
  subscriptionType?: string
}

// Find the index of the closing `}` that balances the `{` at `start`.
// String- and escape-aware so quoted braces inside the JSON don't throw
// the counter off. Returns -1 if no balanced brace is found.
function findMatchingBrace(text: string, start: number): number {
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (escaped) {
      escaped = false
      continue
    }
    if (inString) {
      if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === '{') depth++
    else if (ch === '}' && --depth === 0) return i
  }
  return -1
}

// Extract the first valid JSON object anywhere inside `text`. Tolerates:
//  - pretty-printed (multi-line) JSON, which `claude auth status` emits
//  - trailing noise on stderr (lima/nerdctl fatal lines when the inner
//    command exits non-zero)
//  - leading banners or log lines before the JSON block
function extractFirstJsonObject(text: string): unknown | null {
  let start = text.indexOf('{')
  while (start !== -1) {
    const end = findMatchingBrace(text, start)
    if (end !== -1) {
      try {
        return JSON.parse(text.slice(start, end + 1))
      } catch {
        // malformed, try next `{`
      }
    }
    start = text.indexOf('{', start + 1)
  }
  return null
}

function extractClaudeAuthStatusPayload(
  stdout: string,
): ClaudeAuthStatusPayload | null {
  const parsed = extractFirstJsonObject(stdout)
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    return parsed as ClaudeAuthStatusPayload
  }
  return null
}

function parseClaudeAuthStatus(
  stdout: string,
  exitCode: number,
): OpenClawCliProviderAuthStatus {
  // Binary missing: npm install hasn't landed, or PATH is wrong.
  if (exitCode === 127 || /not found|No such file/i.test(stdout)) {
    return { installed: false, loggedIn: false }
  }

  const payload = extractClaudeAuthStatusPayload(stdout)
  if (payload) {
    return {
      installed: true,
      loggedIn: !!payload.loggedIn,
      accountLabel: payload.email,
      subscriptionLabel: payload.subscriptionType,
    }
  }

  return {
    installed: true,
    loggedIn: false,
    error: stdout.slice(0, 500) || 'claude auth status failed',
  }
}

export const CLAUDE_CLI_PROVIDER: OpenClawCliProvider = {
  id: 'claude-cli',
  displayName: 'Anthropic Claude CLI',
  description: 'Uses your Claude.ai subscription via the Claude Code CLI',
  npmPackage: '@anthropic-ai/claude-code',
  binary: 'claude',
  authStatusCommand: ['claude', 'auth', 'status'],
  // `claude auth login` in 2.1.x silently discards stdin. The REPL's
  // `/login` slash command, launched from a fresh `claude` invocation,
  // does accept a pasted token.
  authLoginCommand: 'claude /login',
  models: CLAUDE_CLI_MODELS,
  parseAuthStatus: parseClaudeAuthStatus,
}
