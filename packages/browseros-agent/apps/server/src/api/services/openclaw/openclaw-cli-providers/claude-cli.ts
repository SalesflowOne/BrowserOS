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

function parseClaudeAuthStatus(
  stdout: string,
  exitCode: number,
): OpenClawCliProviderAuthStatus {
  // Binary missing: npm install hasn't landed, or PATH is wrong.
  if (exitCode === 127 || /not found|No such file/i.test(stdout)) {
    return { installed: false, loggedIn: false }
  }

  // `claude auth status` emits JSON on both success (exit 0) and the
  // "not logged in" path (exit 1). Try JSON first; fall back to a
  // generic error only if the output isn't parseable.
  try {
    const parsed = JSON.parse(stdout) as {
      loggedIn?: boolean
      email?: string
      subscriptionType?: string
    }
    return {
      installed: true,
      loggedIn: !!parsed.loggedIn,
      accountLabel: parsed.email,
      subscriptionLabel: parsed.subscriptionType,
    }
  } catch {
    return {
      installed: true,
      loggedIn: false,
      error: stdout.slice(0, 500) || 'claude auth status failed',
    }
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
