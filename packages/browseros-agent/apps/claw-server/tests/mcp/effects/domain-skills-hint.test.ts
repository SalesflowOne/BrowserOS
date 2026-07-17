/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Unit coverage for the domain-skills-hint dispatch effect. Feature
 * is behind BROWSERCLAW_RECIPES; we set the runtime flag directly on
 * the env module (matching the test pattern used elsewhere) rather
 * than round-tripping through the process env.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { env } from '../../../src/env'
import type { ClientIdentity } from '../../../src/lib/mcp-session'
import { identityService } from '../../../src/lib/mcp-session'
import type { ToolCall } from '../../../src/mcp/dispatch'
import { applyDomainSkillsHint } from '../../../src/mcp/effects/domain-skills-hint'
import type { ToolResult } from '../../../src/mcp/register-fn'
import { recipesDirFor } from '../../../src/services/recipes'
import { withTempBrowserClawDir } from '../../_helpers/temp-browserclaw-dir'

function register(sessionId: string): ClientIdentity {
  return identityService.registerInitialize({
    sessionId,
    clientInfo: { name: 'Claude Code', version: '1.0.0' },
  })
}

function makeCall(
  identity: ClientIdentity | null,
  toolName: string,
  args: Record<string, unknown> = {},
): ToolCall {
  return {
    tool: { name: toolName } as never,
    args,
    sessionId: identity?.sessionId ?? '',
    identity,
    key: identity?.key ?? null,
    agent: identity ? { agentId: identity.key, slug: identity.slug } : null,
    agentLabel: identity?.clientName ?? null,
    session: {} as never,
    defaultTabGroupId: null,
    flags: { newPage: false, closePage: false, listTabs: false },
  }
}

function makeResult(overrides: Partial<ToolResult> = {}): ToolResult {
  return {
    content: [{ type: 'text', text: 'navigated to https://linkedin.com/' }],
    isError: false,
    structuredContent: { url: 'https://linkedin.com/' },
    ...overrides,
  }
}

function apply(call: ToolCall, result: ToolResult): ToolResult | undefined {
  return applyDomainSkillsHint({
    call,
    result,
    cancelled: false,
    durationMs: 1,
  })
}

function seedRecipe(slug: string, hostStem: string, name: string): string {
  const dir = recipesDirFor(slug, hostStem)
  mkdirSync(dir, { recursive: true })
  const path = `${dir}/${name}`
  writeFileSync(path, `# ${name}\nA test recipe.\n`)
  return path
}

describe('domain-skills-hint', () => {
  beforeEach(() => {
    identityService.clear()
    env.recipesEnabled = true
  })
  afterEach(() => {
    env.recipesEnabled = false
  })

  it('is a no-op when the recipesEnabled flag is off', async () => {
    await withTempBrowserClawDir(async () => {
      env.recipesEnabled = false
      const identity = register('s1')
      seedRecipe(identity.slug, 'linkedin', 'invitation.md')

      expect(
        apply(makeCall(identity, 'navigate'), makeResult()),
      ).toBeUndefined()
    })
  })

  it('is a no-op for non-navigate tools', async () => {
    await withTempBrowserClawDir(async () => {
      const identity = register('s1')
      seedRecipe(identity.slug, 'linkedin', 'invitation.md')

      expect(
        apply(makeCall(identity, 'snapshot'), makeResult()),
      ).toBeUndefined()
    })
  })

  it('passes through error results untouched', async () => {
    await withTempBrowserClawDir(async () => {
      const identity = register('s1')
      seedRecipe(identity.slug, 'linkedin', 'invitation.md')

      const errorResult = makeResult({ isError: true })
      expect(apply(makeCall(identity, 'navigate'), errorResult)).toBeUndefined()
    })
  })

  it('is a no-op when the caller has no registered identity', async () => {
    await withTempBrowserClawDir(async () => {
      const call = makeCall(null, 'navigate')
      expect(apply(call, makeResult())).toBeUndefined()
    })
  })

  it('is a no-op when the destination URL has no host stem', async () => {
    await withTempBrowserClawDir(async () => {
      const identity = register('s1')
      const call = makeCall(identity, 'navigate', { url: 'chrome://newtab' })
      const result = makeResult({
        structuredContent: { url: 'chrome://newtab' },
      })
      expect(apply(call, result)).toBeUndefined()
    })
  })

  it('annotates a cold host with an empty file list + workspace dir hint', async () => {
    await withTempBrowserClawDir(async () => {
      const identity = register('s1')
      const returned = apply(
        makeCall(identity, 'navigate', { url: 'https://linkedin.com/' }),
        makeResult(),
      )
      expect(returned).toBeDefined()

      const structured = returned?.structuredContent as {
        url: string
        domain_skills: { files: string[]; workspace_dir: string }
      }
      expect(structured.url).toBe('https://linkedin.com/')
      expect(structured.domain_skills.files).toEqual([])
      expect(structured.domain_skills.workspace_dir).toContain(
        `/recipes/${identity.slug}/linkedin`,
      )

      const trailing = returned?.content[returned.content.length - 1]
      expect(trailing?.type).toBe('text')
      expect((trailing as { text: string }).text).toContain('none yet')
    })
  })

  it('surfaces existing recipe filenames on a warm host', async () => {
    await withTempBrowserClawDir(async () => {
      const identity = register('s1')
      seedRecipe(identity.slug, 'linkedin', 'invitation-manager.md')
      seedRecipe(identity.slug, 'linkedin', 'message-composer.md')

      const returned = apply(makeCall(identity, 'navigate'), makeResult())
      expect(returned).toBeDefined()

      const structured = returned?.structuredContent as {
        domain_skills: { files: string[] }
      }
      expect(structured.domain_skills.files).toEqual([
        'invitation-manager.md',
        'message-composer.md',
      ])

      const trailing = returned?.content[returned.content.length - 1]
      expect((trailing as { text: string }).text).toContain(
        'invitation-manager.md, message-composer.md',
      )
    })
  })

  it('falls back to args.url when the result has no structuredContent.url', async () => {
    await withTempBrowserClawDir(async () => {
      const identity = register('s1')
      seedRecipe(identity.slug, 'linkedin', 'invitation.md')

      const call = makeCall(identity, 'navigate', {
        url: 'https://www.linkedin.com/foo',
      })
      const result = makeResult({ structuredContent: undefined })
      const returned = apply(call, result)
      expect(returned).toBeDefined()
      const structured = returned?.structuredContent as {
        domain_skills: { files: string[] }
      }
      expect(structured.domain_skills.files).toEqual(['invitation.md'])
    })
  })

  it('preserves other structuredContent fields', async () => {
    await withTempBrowserClawDir(async () => {
      const identity = register('s1')
      const result = makeResult({
        structuredContent: {
          url: 'https://linkedin.com/',
          page: 42,
          title: 'LinkedIn',
        },
      })
      const returned = apply(makeCall(identity, 'navigate'), result)
      const structured = returned?.structuredContent as Record<string, unknown>
      expect(structured.url).toBe('https://linkedin.com/')
      expect(structured.page).toBe(42)
      expect(structured.title).toBe('LinkedIn')
      expect(structured.domain_skills).toBeDefined()
    })
  })

  it('isolates one agent slug from another', async () => {
    await withTempBrowserClawDir(async () => {
      const claude = register('s-claude')
      const codex = identityService.registerInitialize({
        sessionId: 's-codex',
        clientInfo: { name: 'Codex MCP Client', version: '1.0.0' },
      })
      seedRecipe(claude.slug, 'linkedin', 'mine.md')
      seedRecipe(codex.slug, 'linkedin', 'theirs.md')

      const claudeReturned = apply(makeCall(claude, 'navigate'), makeResult())
      const codexReturned = apply(makeCall(codex, 'navigate'), makeResult())

      const claudeStructured = claudeReturned?.structuredContent as {
        domain_skills: { files: string[] }
      }
      const codexStructured = codexReturned?.structuredContent as {
        domain_skills: { files: string[] }
      }
      expect(claudeStructured.domain_skills.files).toEqual(['mine.md'])
      expect(codexStructured.domain_skills.files).toEqual(['theirs.md'])
    })
  })
})
