/**
 * @license
 * Copyright 2025 BrowserOS
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readSoulPrompt } from '../../src/agent/soul-prompt'

const LEGACY_SOUL = `# SOUL.md — Who You Are
_You're not a chatbot. You're becoming someone._
`

describe('readSoulPrompt', () => {
  const originalBrowserosDir = process.env.BROWSEROS_DIR
  let browserosDir: string

  beforeEach(async () => {
    browserosDir = await mkdtemp(join(tmpdir(), 'browseros-soul-test-'))
    process.env.BROWSEROS_DIR = browserosDir
  })

  afterEach(async () => {
    if (originalBrowserosDir === undefined) {
      delete process.env.BROWSEROS_DIR
    } else {
      process.env.BROWSEROS_DIR = originalBrowserosDir
    }
    await rm(browserosDir, { recursive: true, force: true })
  })

  it('ignores the legacy root SOUL.md template', async () => {
    await writeFile(join(browserosDir, 'SOUL.md'), LEGACY_SOUL, 'utf8')

    await expect(readSoulPrompt()).resolves.toBeUndefined()
  })

  it('ignores custom root SOUL.md content', async () => {
    await writeFile(
      join(browserosDir, 'SOUL.md'),
      'Keep replies terse.',
      'utf8',
    )

    await expect(readSoulPrompt()).resolves.toBeUndefined()
  })
})
