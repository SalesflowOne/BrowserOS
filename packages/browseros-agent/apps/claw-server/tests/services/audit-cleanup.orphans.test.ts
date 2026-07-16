/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Orphan sweep tests. The sweep is bundled into cleanupOlderThan()
 * and also runs on a delayed startup pass. Tests seed files with
 * controlled mtimes so the 5-minute in-flight guard fires
 * deterministically.
 */

import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test'
import { existsSync, mkdirSync, utimesSync, writeFileSync } from 'node:fs'
import { eq } from 'drizzle-orm'
import { resolveClawServerPath } from '../../src/lib/browserclaw-dir'
import { logger } from '../../src/lib/logger'
import {
  getAuditDb,
  resetAuditDbForTesting,
  setAuditDbForTesting,
} from '../../src/modules/db/db'
import { toolDispatches } from '../../src/modules/db/schema/schema'
import {
  cleanupOlderThan,
  sweepOrphanFiles,
} from '../../src/services/audit-cleanup'
import { runStartupSweep } from '../../src/services/audit-cleanup-startup'
import { recordToolDispatch } from '../../src/services/audit-log'
import { screenshotPath } from '../../src/services/screenshots'
import { recordSessionStart } from '../../src/services/session-events'
import { withTempBrowserClawDir } from '../_helpers/temp-browserclaw-dir'

const MS_PER_DAY = 86_400_000
const TEN_MIN_AGO_SEC = Math.floor((Date.now() - 10 * 60 * 1000) / 1000)
const RECENT_SEC = Math.floor(Date.now() / 1000)

function writeReplayFile(sessionId: string, mtimeSec: number): string {
  const dir = resolveClawServerPath('replays')
  mkdirSync(dir, { recursive: true })
  const path = `${dir}/${sessionId}.ndjson`
  writeFileSync(path, `{"ts":${Date.now()},"type":4}\n`)
  utimesSync(path, mtimeSec, mtimeSec)
  return path
}

function writeScreenshotFile(dispatchId: number, mtimeSec: number): string {
  const path = screenshotPath(dispatchId)
  mkdirSync(path.split('/').slice(0, -1).join('/'), { recursive: true })
  writeFileSync(path, Buffer.from([0xff, 0xd8, 0xff, 0xd9]))
  utimesSync(path, mtimeSec, mtimeSec)
  return path
}

function writeArbitraryFile(
  dir: string,
  name: string,
  mtimeSec: number,
): string {
  const full = resolveClawServerPath(dir, name)
  mkdirSync(resolveClawServerPath(dir), { recursive: true })
  writeFileSync(full, 'garbage')
  utimesSync(full, mtimeSec, mtimeSec)
  return full
}

function seedSession(sessionId: string, dispatchTool = 'act'): number | null {
  recordSessionStart({
    sessionId,
    agentId: 'claude-code',
    slug: 'claude-code',
    agentLabel: 'Claude Code',
    clientName: 'claude-code',
    clientVersion: '0.0.0',
  })
  return recordToolDispatch({
    agentId: 'claude-code',
    slug: 'claude-code',
    agentLabel: 'Claude Code',
    sessionId,
    toolName: dispatchTool,
    pageId: 1,
    targetId: null,
    url: null,
    title: null,
    rawArgs: {},
    durationMs: 5,
    result: {
      isError: false,
      structuredContent: {},
      content: [{ type: 'text', text: 'ok' }],
    },
  })
}

describe('audit-cleanup orphan sweep', () => {
  beforeEach(() => setAuditDbForTesting())
  afterEach(() => resetAuditDbForTesting())

  it('unlinks a replay file whose session id has no DB row', async () => {
    await withTempBrowserClawDir(async () => {
      const orphan = writeReplayFile('phantom-session', TEN_MIN_AGO_SEC)
      expect(existsSync(orphan)).toBe(true)

      const r = await sweepOrphanFiles()
      expect(r.replayFilesDeleted).toBe(1)
      expect(r.bytesFreed).toBeGreaterThan(0)
      expect(existsSync(orphan)).toBe(false)
    })
  })

  it('unlinks a screenshot whose dispatch id has no DB row', async () => {
    await withTempBrowserClawDir(async () => {
      const orphan = writeScreenshotFile(999_999, TEN_MIN_AGO_SEC)
      expect(existsSync(orphan)).toBe(true)

      const r = await sweepOrphanFiles()
      expect(r.screenshotFilesDeleted).toBe(1)
      expect(existsSync(orphan)).toBe(false)
    })
  })

  it('leaves a fresh orphan alone (in-flight guard)', async () => {
    await withTempBrowserClawDir(async () => {
      const orphan = writeReplayFile('fresh-session', RECENT_SEC)
      const r = await sweepOrphanFiles()
      expect(r.replayFilesDeleted).toBe(0)
      expect(existsSync(orphan)).toBe(true)
    })
  })

  it('keeps files whose id still has a DB row', async () => {
    await withTempBrowserClawDir(async () => {
      const dispatchId = seedSession('kept-session') as number
      writeReplayFile('kept-session', TEN_MIN_AGO_SEC)
      writeScreenshotFile(dispatchId, TEN_MIN_AGO_SEC)

      const r = await sweepOrphanFiles()
      expect(r.replayFilesDeleted).toBe(0)
      expect(r.screenshotFilesDeleted).toBe(0)
      expect(
        existsSync(`${resolveClawServerPath('replays')}/kept-session.ndjson`),
      ).toBe(true)
      expect(existsSync(screenshotPath(dispatchId))).toBe(true)
    })
  })

  it('ignores files with unexpected extensions', async () => {
    await withTempBrowserClawDir(async () => {
      const foreign = writeArbitraryFile('replays', 'note.txt', TEN_MIN_AGO_SEC)
      const r = await sweepOrphanFiles()
      expect(r.replayFilesDeleted).toBe(0)
      expect(existsSync(foreign)).toBe(true)
    })
  })

  it('ignores screenshot files whose basename is not an integer', async () => {
    await withTempBrowserClawDir(async () => {
      const foreign = writeArbitraryFile(
        'screenshots',
        'junk.jpg',
        TEN_MIN_AGO_SEC,
      )
      const r = await sweepOrphanFiles()
      expect(r.screenshotFilesDeleted).toBe(0)
      expect(existsSync(foreign)).toBe(true)
    })
  })

  it('reports orphan counts as part of cleanupOlderThan result', async () => {
    await withTempBrowserClawDir(async () => {
      // Seed a real (fresh) session so cleanupOlderThan finds nothing to
      // age-delete, and drop an orphan file into the replays dir.
      seedSession('s-fresh')
      writeReplayFile('drifted', TEN_MIN_AGO_SEC)

      const r = await cleanupOlderThan(15)
      expect(r.sessionsDeleted).toBe(0)
      expect(r.orphans.replayFilesDeleted).toBe(1)
      expect(r.orphans.bytesFreed).toBeGreaterThan(0)
    })
  })

  it('handles a missing directory gracefully', async () => {
    await withTempBrowserClawDir(async () => {
      // No replays/ or screenshots/ directory exists yet.
      const r = await sweepOrphanFiles()
      expect(r.replayFilesDeleted).toBe(0)
      expect(r.screenshotFilesDeleted).toBe(0)
      expect(r.bytesFreed).toBe(0)
    })
  })

  it('runStartupSweep logs a result even when nothing to sweep', async () => {
    await withTempBrowserClawDir(async () => {
      const infoSpy = spyOn(logger, 'info')
      try {
        await runStartupSweep()
        const call = infoSpy.mock.calls.find((c) => c[0] === 'orphan sweep')
        expect(call).toBeDefined()
        expect(call?.[1]).toMatchObject({
          replayFilesDeleted: 0,
          screenshotFilesDeleted: 0,
          bytesFreed: 0,
          source: 'startup',
        })
      } finally {
        infoSpy.mockRestore()
      }
    })
  })

  it('after an age-based cleanup deletes rows, orphan sweep skips their files (already unlinked)', async () => {
    await withTempBrowserClawDir(async () => {
      recordSessionStart({
        sessionId: 's-old',
        agentId: 'claude-code',
        slug: 'claude-code',
        agentLabel: 'Claude Code',
        clientName: 'claude-code',
        clientVersion: '0.0.0',
      })
      const dOld = recordToolDispatch({
        agentId: 'claude-code',
        slug: 'claude-code',
        agentLabel: 'Claude Code',
        sessionId: 's-old',
        toolName: 'act',
        pageId: 1,
        targetId: null,
        url: null,
        title: null,
        rawArgs: {},
        durationMs: 5,
        result: {
          isError: false,
          structuredContent: {},
          content: [{ type: 'text', text: 'ok' }],
        },
      }) as number
      // Backdate the session so cleanupOlderThan finds it.
      getAuditDb()
        .update(toolDispatches)
        .set({ createdAt: Date.now() - 100 * MS_PER_DAY })
        .where(eq(toolDispatches.sessionId, 's-old'))
        .run()

      // Seed the on-disk artefacts.
      writeReplayFile('s-old', TEN_MIN_AGO_SEC)
      writeScreenshotFile(dOld, TEN_MIN_AGO_SEC)

      const r = await cleanupOlderThan(15)
      // Age-based delete removed 1 session + 1 dispatch + 2 files.
      expect(r.sessionsDeleted).toBe(1)
      expect(r.replayFilesDeleted).toBe(1)
      expect(r.screenshotFilesDeleted).toBe(1)
      // Orphan sweep in the same call finds nothing left to do.
      expect(r.orphans.replayFilesDeleted).toBe(0)
      expect(r.orphans.screenshotFilesDeleted).toBe(0)
    })
  })
})
