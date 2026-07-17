/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Unit coverage for the recipes service: URL-to-host-stem reduction
 * (must match browser-harness's helpers.py:134 for portability),
 * directory read behaviour including caps and edge cases.
 */

import { describe, expect, it } from 'bun:test'
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import {
  hostStemFromUrl,
  listRecipeFiles,
  MAX_SKILLS_SURFACED,
  recipesDirFor,
} from '../../src/services/recipes'
import { withTempBrowserClawDir } from '../_helpers/temp-browserclaw-dir'

describe('hostStemFromUrl', () => {
  it('collapses www + tld to the first label', () => {
    expect(hostStemFromUrl('https://www.linkedin.com/foo')).toBe('linkedin')
    expect(hostStemFromUrl('https://linkedin.com/foo')).toBe('linkedin')
  })

  it('takes the leftmost label for subdomains (matches browser-harness)', () => {
    // helpers.py:134 in the upstream: hostname.removeprefix("www.").split(".")[0]
    // So mail.google.com yields 'mail', not 'google'.
    expect(hostStemFromUrl('https://mail.google.com/inbox')).toBe('mail')
    expect(hostStemFromUrl('https://docs.github.com/en')).toBe('docs')
  })

  it('returns null for URLs without a hostname', () => {
    expect(hostStemFromUrl('about:blank')).toBeNull()
    expect(hostStemFromUrl('chrome://newtab')).toBeNull()
    expect(hostStemFromUrl('')).toBeNull()
    expect(hostStemFromUrl('not a url')).toBeNull()
  })

  it('handles IPs and localhost as-is', () => {
    // '127.0.0.1'.split('.')[0] === '127'; keying by '127' is odd but
    // consistent. Documented so nobody expects IP-aware handling.
    expect(hostStemFromUrl('http://localhost:9200/')).toBe('localhost')
    expect(hostStemFromUrl('http://127.0.0.1:9200/')).toBe('127')
  })
})

describe('recipesDirFor', () => {
  it('resolves under the browserclaw dir and joins slug + host', async () => {
    await withTempBrowserClawDir(async (root) => {
      expect(recipesDirFor('claude-code', 'linkedin')).toBe(
        `${root}/recipes/claude-code/linkedin`,
      )
    })
  })
})

describe('listRecipeFiles', () => {
  it('returns an empty list when the directory does not exist', async () => {
    await withTempBrowserClawDir(async () => {
      expect(listRecipeFiles('claude-code', 'linkedin')).toEqual([])
    })
  })

  it('returns only .md files, sorted', async () => {
    await withTempBrowserClawDir(async () => {
      const dir = recipesDirFor('claude-code', 'linkedin')
      mkdirSync(dir, { recursive: true })
      writeFileSync(`${dir}/b.md`, 'b')
      writeFileSync(`${dir}/a.md`, 'a')
      writeFileSync(`${dir}/notes.txt`, 'ignored')

      expect(listRecipeFiles('claude-code', 'linkedin')).toEqual([
        'a.md',
        'b.md',
      ])
    })
  })

  it('caps at MAX_SKILLS_SURFACED', async () => {
    await withTempBrowserClawDir(async () => {
      const dir = recipesDirFor('claude-code', 'linkedin')
      mkdirSync(dir, { recursive: true })
      for (let i = 0; i < 15; i += 1) {
        writeFileSync(`${dir}/skill-${i.toString().padStart(2, '0')}.md`, '')
      }
      const result = listRecipeFiles('claude-code', 'linkedin')
      expect(result).toHaveLength(MAX_SKILLS_SURFACED)
      // Sorted, so the first cap-many win.
      expect(result[0]).toBe('skill-00.md')
      expect(result[MAX_SKILLS_SURFACED - 1]).toBe('skill-09.md')
    })
  })

  it('skips subdirectories that happen to end in .md', async () => {
    await withTempBrowserClawDir(async () => {
      const dir = recipesDirFor('claude-code', 'linkedin')
      mkdirSync(`${dir}/somefolder.md`, { recursive: true })
      writeFileSync(`${dir}/real.md`, '')
      expect(listRecipeFiles('claude-code', 'linkedin')).toEqual(['real.md'])
    })
  })

  it('isolates one agent slug from another', async () => {
    await withTempBrowserClawDir(async () => {
      mkdirSync(recipesDirFor('claude-code', 'linkedin'), { recursive: true })
      mkdirSync(recipesDirFor('codex-mcp-client', 'linkedin'), {
        recursive: true,
      })
      writeFileSync(`${recipesDirFor('claude-code', 'linkedin')}/mine.md`, '')
      writeFileSync(
        `${recipesDirFor('codex-mcp-client', 'linkedin')}/theirs.md`,
        '',
      )

      expect(listRecipeFiles('claude-code', 'linkedin')).toEqual(['mine.md'])
      expect(listRecipeFiles('codex-mcp-client', 'linkedin')).toEqual([
        'theirs.md',
      ])
    })
  })

  it('isolates one host from another', async () => {
    await withTempBrowserClawDir(async () => {
      mkdirSync(recipesDirFor('claude-code', 'linkedin'), { recursive: true })
      mkdirSync(recipesDirFor('claude-code', 'github'), { recursive: true })
      writeFileSync(
        `${recipesDirFor('claude-code', 'linkedin')}/invitation.md`,
        '',
      )
      writeFileSync(`${recipesDirFor('claude-code', 'github')}/create.md`, '')

      expect(listRecipeFiles('claude-code', 'linkedin')).toEqual([
        'invitation.md',
      ])
      expect(listRecipeFiles('claude-code', 'github')).toEqual(['create.md'])
    })
  })

  it('follows a symlink that points at a real .md file', async () => {
    await withTempBrowserClawDir(async () => {
      const dir = recipesDirFor('claude-code', 'linkedin')
      mkdirSync(dir, { recursive: true })
      writeFileSync(`${dir}/target.md`, 'ok')
      symlinkSync(`${dir}/target.md`, `${dir}/alias.md`)
      // Both surface (statSync follows symlinks by default), sorted.
      expect(listRecipeFiles('claude-code', 'linkedin')).toEqual([
        'alias.md',
        'target.md',
      ])
    })
  })
})
