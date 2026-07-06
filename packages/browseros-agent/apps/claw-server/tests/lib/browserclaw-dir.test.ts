/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { PATHS } from '@browseros/shared/constants/paths'
import { env } from '../../src/env'
import {
  getBrowserClawDir,
  getClawServerDir,
  migrateLegacyClawServerHome,
  resolveClawServerPath,
} from '../../src/lib/browserclaw-dir'

const original = {
  browserclawDirOverride: env.browserclawDirOverride,
  isDevelopment: env.isDevelopment,
  // biome-ignore lint/style/noProcessEnv: this test preserves and restores the ignored legacy env var
  browserosDir: process.env.BROWSEROS_DIR,
}

beforeEach(() => {
  env.browserclawDirOverride = undefined
  env.isDevelopment = false
  // biome-ignore lint/style/noProcessEnv: this test proves the legacy env var is ignored
  delete process.env.BROWSEROS_DIR
})

afterEach(() => {
  env.browserclawDirOverride = original.browserclawDirOverride
  env.isDevelopment = original.isDevelopment
  if (original.browserosDir === undefined) {
    // biome-ignore lint/style/noProcessEnv: restore the legacy env var after the isolation test
    delete process.env.BROWSEROS_DIR
  } else {
    // biome-ignore lint/style/noProcessEnv: restore the legacy env var after the isolation test
    process.env.BROWSEROS_DIR = original.browserosDir
  }
})

describe('browserclaw dir resolver', () => {
  test('uses ~/.browserclaw in production', () => {
    expect(getBrowserClawDir()).toBe(
      join(homedir(), PATHS.BROWSERCLAW_DIR_NAME),
    )
    expect(getClawServerDir()).toBe(getBrowserClawDir())
  })

  test('uses ~/.browserclaw-dev in development', () => {
    env.isDevelopment = true

    expect(getBrowserClawDir()).toBe(
      join(homedir(), PATHS.DEV_BROWSERCLAW_DIR_NAME),
    )
  })

  test('uses BROWSERCLAW_DIR override from the env snapshot', () => {
    env.browserclawDirOverride = '/tmp/browserclaw-custom'

    expect(getBrowserClawDir()).toBe('/tmp/browserclaw-custom')
    expect(resolveClawServerPath('agents', 'one.json')).toBe(
      '/tmp/browserclaw-custom/agents/one.json',
    )
  })

  test('ignores BROWSEROS_DIR for claw-server storage', () => {
    // biome-ignore lint/style/noProcessEnv: this test proves the legacy env var is ignored
    process.env.BROWSEROS_DIR = '/tmp/browseros-should-not-apply'

    expect(getBrowserClawDir()).toBe(
      join(homedir(), PATHS.BROWSERCLAW_DIR_NAME),
    )
  })

  test('resolves caller paths directly under the BrowserClaw home', () => {
    env.browserclawDirOverride = '/tmp/browserclaw-root'

    expect(resolveClawServerPath('screenshots', '1.jpg')).toBe(
      '/tmp/browserclaw-root/screenshots/1.jpg',
    )
  })
})

describe('legacy claw-server home migration', () => {
  test('moves legacy nested BrowserOS state into the BrowserClaw home', async () => {
    const root = await mkdtemp(join(tmpdir(), 'browserclaw-migration-'))
    try {
      const from = join(root, '.browseros', 'claw-server')
      const to = join(root, '.browserclaw')
      await mkdir(from, { recursive: true })
      await writeFile(join(from, 'agents.json'), '{"ok":true}', 'utf8')

      const result = await migrateLegacyClawServerHome({ from, to })

      expect(result).toEqual({ status: 'migrated', from, to })
      expect(existsSync(from)).toBe(false)
      expect(readFileSync(join(to, 'agents.json'), 'utf8')).toBe('{"ok":true}')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('does not overwrite an existing BrowserClaw home', async () => {
    const root = await mkdtemp(join(tmpdir(), 'browserclaw-migration-'))
    try {
      const from = join(root, '.browseros', 'claw-server')
      const to = join(root, '.browserclaw')
      await mkdir(from, { recursive: true })
      await mkdir(to, { recursive: true })
      await writeFile(join(from, 'old.json'), '{"old":true}', 'utf8')
      await writeFile(join(to, 'new.json'), '{"new":true}', 'utf8')

      const result = await migrateLegacyClawServerHome({ from, to })

      expect(result).toEqual({
        status: 'skipped',
        reason: 'target-exists',
        from,
        to,
      })
      expect(readFileSync(join(from, 'old.json'), 'utf8')).toBe('{"old":true}')
      expect(readFileSync(join(to, 'new.json'), 'utf8')).toBe('{"new":true}')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('skips default migration when a custom BrowserClaw override is set', async () => {
    env.browserclawDirOverride = '/tmp/custom-browserclaw-root'

    const result = await migrateLegacyClawServerHome()

    expect(result).toEqual({
      status: 'skipped',
      reason: 'custom-override',
      from: join(homedir(), PATHS.BROWSEROS_DIR_NAME, 'claw-server'),
      to: '/tmp/custom-browserclaw-root',
    })
  })
})
