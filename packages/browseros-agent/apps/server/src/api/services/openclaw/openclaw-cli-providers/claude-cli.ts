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

  if (exitCode !== 0) {
    return {
      installed: true,
      loggedIn: false,
      error: stdout.slice(0, 500) || 'claude auth status failed',
    }
  }

  // `claude auth status` prints JSON by default.
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
      error: 'Unexpected claude auth status output',
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
  authLoginCommand: 'claude auth login',
  models: CLAUDE_CLI_MODELS,
  parseAuthStatus: parseClaudeAuthStatus,
}
