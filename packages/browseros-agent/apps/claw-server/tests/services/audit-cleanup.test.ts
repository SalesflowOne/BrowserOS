/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Age-based cleanup tests. Seeds sessions with controlled createdAt
 * values by patching the row after the dispatch writer runs (the
 * writer sets createdAt to Date.now() via $defaultFn per PR #1846, so
 * we UPDATE after insert to backdate).
 *
 * Orphan-sweep tests live in the sibling file
 * `audit-cleanup.orphans.test.ts` so this file stays focused on the
 * age-based path.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { eq, sql } from 'drizzle-orm'
import {
  getAuditDb,
  resetAuditDbForTesting,
  setAuditDbForTesting,
} from '../../src/modules/db/db'
import {
  agentSessionEnds,
  agentSessionStarts,
  toolDispatches,
} from '../../src/modules/db/schema/schema'
import {
  candidatesFor,
  cleanupOlderThan,
  listCandidates,
} from '../../src/services/audit-cleanup'
import { recordToolDispatch } from '../../src/services/audit-log'
import { replayStorage } from '../../src/services/replay-storage'
import { screenshotPath } from '../../src/services/screenshots'
import {
  recordSessionEnd,
  recordSessionStart,
} from '../../src/services/session-events'
import { withTempBrowserClawDir } from '../_helpers/temp-browserclaw-dir'

const MS_PER_DAY = 86_400_000

function dispatch(sessionId: string, toolName = 'act'): number | null {
  return recordToolDispatch({
    agentId: 'claude-code',
    slug: 'claude-code',
    agentLabel: 'Claude Code',
    sessionId,
    toolName,
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

/**
 * Backdates every dispatch AND session-start/end row for a session so
 * `max(created_at)` for the session becomes exactly `daysOld` days
 * ago. Cleanup groups sessions by `max(created_at)`, so we backdate to
 * a single moment instead of scattering.
 */
function backdateSession(sessionId: string, daysOld: number): void {
  const targetMs = Date.now() - daysOld * MS_PER_DAY
  const db = getAuditDb()
  db.update(toolDispatches)
    .set({ createdAt: targetMs })
    .where(eq(toolDispatches.sessionId, sessionId))
    .run()
  db.update(agentSessionStarts)
    .set({ createdAt: targetMs })
    .where(eq(agentSessionStarts.sessionId, sessionId))
    .run()
  db.update(agentSessionEnds)
    .set({ createdAt: targetMs })
    .where(eq(agentSessionEnds.sessionId, sessionId))
    .run()
}

function startSession(sessionId: string): void {
  recordSessionStart({
    sessionId,
    agentId: 'claude-code',
    slug: 'claude-code',
    agentLabel: 'Claude Code',
    clientName: 'claude-code',
    clientVersion: '0.0.0',
  })
}

function seedScreenshotFile(dispatchId: number | null): void {
  if (typeof dispatchId !== 'number') return
  const path = screenshotPath(dispatchId)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, Buffer.from([0xff, 0xd8, 0xff, 0xd9]))
}

async function seedReplayFile(sessionId: string): Promise<void> {
  // Uses the storage's own writer so paths/sanitisation stay in sync.
  await replayStorage.appendEvents(sessionId, [
    JSON.stringify({ ts: Date.now(), type: 4 }),
  ])
}

describe('audit-cleanup age-based', () => {
  beforeEach(() => setAuditDbForTesting())
  afterEach(async () => {
    resetAuditDbForTesting()
    await replayStorage.resetForTesting()
  })

  it('deletes sessions strictly older than the threshold', async () => {
    await withTempBrowserClawDir(async () => {
      // Three sessions aged 5, 20, 100 days.
      startSession('s-5')
      const d5 = dispatch('s-5', 'act')
      backdateSession('s-5', 5)
      startSession('s-20')
      const d20 = dispatch('s-20', 'act')
      backdateSession('s-20', 20)
      startSession('s-100')
      const d100 = dispatch('s-100', 'act')
      backdateSession('s-100', 100)

      seedScreenshotFile(d5)
      seedScreenshotFile(d20)
      seedScreenshotFile(d100)

      // cleanupOlderThan(15) removes 20d and 100d, leaves 5d.
      const r15 = await cleanupOlderThan(15)
      expect(r15.sessionsDeleted).toBe(2)
      expect(r15.dispatchesDeleted).toBe(2)

      const survivors = getAuditDb()
        .select({ id: toolDispatches.sessionId })
        .from(toolDispatches)
        .groupBy(toolDispatches.sessionId)
        .all()
        .map((r) => r.id)
      expect(survivors).toEqual(['s-5'])
    })
  })

  it('90-day threshold only nukes truly ancient sessions', async () => {
    await withTempBrowserClawDir(async () => {
      startSession('s-30')
      dispatch('s-30', 'act')
      backdateSession('s-30', 30)
      startSession('s-100')
      dispatch('s-100', 'act')
      backdateSession('s-100', 100)

      const r90 = await cleanupOlderThan(90)
      expect(r90.sessionsDeleted).toBe(1)

      const survivors = getAuditDb()
        .select({ id: toolDispatches.sessionId })
        .from(toolDispatches)
        .groupBy(toolDispatches.sessionId)
        .all()
        .map((r) => r.id)
      expect(survivors).toEqual(['s-30'])
    })
  })

  it('leaves a long-lived session with a fresh straggler dispatch alone', async () => {
    // The bug we're guarding against: computing "old" on session start
    // rather than session last-activity would nuke this one.
    await withTempBrowserClawDir(async () => {
      startSession('s-long')
      dispatch('s-long', 'act')
      backdateSession('s-long', 100)

      // Now add a fresh dispatch (undated, i.e. Date.now()) to the
      // same session. `max(created_at)` should shift to ~now.
      dispatch('s-long', 'act')

      const r15 = await cleanupOlderThan(15)
      expect(r15.sessionsDeleted).toBe(0)

      const remaining = getAuditDb()
        .select({ count: sql<number>`count(*)` })
        .from(toolDispatches)
        .all()[0]?.count
      expect(remaining).toBe(2)
    })
  })

  it('unlinks replay + screenshot files for deleted sessions and leaves survivors on disk', async () => {
    await withTempBrowserClawDir(async () => {
      startSession('s-fresh')
      const dFresh = dispatch('s-fresh', 'act')
      backdateSession('s-fresh', 5)
      startSession('s-old')
      const dOld = dispatch('s-old', 'act')
      backdateSession('s-old', 100)

      await seedReplayFile('s-fresh')
      await seedReplayFile('s-old')
      seedScreenshotFile(dFresh)
      seedScreenshotFile(dOld)

      const oldReplay = replayStorage.pathFor('s-old')
      const freshReplay = replayStorage.pathFor('s-fresh')
      const oldShot = screenshotPath(dOld as number)
      const freshShot = screenshotPath(dFresh as number)

      // All four files exist pre-cleanup.
      expect(statSync(oldReplay).size).toBeGreaterThan(0)
      expect(statSync(freshReplay).size).toBeGreaterThan(0)
      expect(statSync(oldShot).size).toBeGreaterThan(0)
      expect(statSync(freshShot).size).toBeGreaterThan(0)

      const r = await cleanupOlderThan(15)
      expect(r.replayFilesDeleted).toBe(1)
      expect(r.screenshotFilesDeleted).toBe(1)
      expect(r.bytesFreed).toBeGreaterThan(0)

      // Old files gone.
      expect(() => statSync(oldReplay)).toThrow()
      expect(() => statSync(oldShot)).toThrow()
      // Fresh files still there.
      expect(statSync(freshReplay).size).toBeGreaterThan(0)
      expect(statSync(freshShot).size).toBeGreaterThan(0)
    })
  })

  it('is idempotent: a second cleanup with the same threshold is a no-op', async () => {
    await withTempBrowserClawDir(async () => {
      startSession('s-old')
      dispatch('s-old', 'act')
      backdateSession('s-old', 100)

      const first = await cleanupOlderThan(15)
      expect(first.sessionsDeleted).toBe(1)

      const second = await cleanupOlderThan(15)
      expect(second.sessionsDeleted).toBe(0)
      expect(second.dispatchesDeleted).toBe(0)
      expect(second.replayFilesDeleted).toBe(0)
      expect(second.screenshotFilesDeleted).toBe(0)
    })
  })

  it('listCandidates returns three zero rows on an empty DB', async () => {
    await withTempBrowserClawDir(async () => {
      const ranges = listCandidates()
      expect(ranges.map((r) => r.olderThanDays)).toEqual([15, 30, 90])
      for (const r of ranges) {
        expect(r.sessionCount).toBe(0)
        expect(r.dispatchCount).toBe(0)
        expect(r.bytesOnDisk).toBe(0)
      }
    })
  })

  it('candidatesFor reports counts that match cleanup outcome', async () => {
    await withTempBrowserClawDir(async () => {
      startSession('s-old-1')
      dispatch('s-old-1', 'act')
      dispatch('s-old-1', 'read')
      backdateSession('s-old-1', 100)

      startSession('s-old-2')
      dispatch('s-old-2', 'act')
      backdateSession('s-old-2', 40)

      startSession('s-fresh')
      dispatch('s-fresh', 'act')
      backdateSession('s-fresh', 5)

      // 15-day threshold: covers both old-1 and old-2.
      const c15 = candidatesFor(15)
      expect(c15.sessionCount).toBe(2)
      expect(c15.dispatchCount).toBe(3)

      // 90-day threshold: only old-1.
      const c90 = candidatesFor(90)
      expect(c90.sessionCount).toBe(1)
      expect(c90.dispatchCount).toBe(2)

      // And now delete: the reported count matches candidates.
      const r = await cleanupOlderThan(15)
      expect(r.sessionsDeleted).toBe(c15.sessionCount)
      expect(r.dispatchesDeleted).toBe(c15.dispatchCount)
    })
  })

  it('deletes agent_session_starts and agent_session_ends rows together with dispatches', async () => {
    await withTempBrowserClawDir(async () => {
      startSession('s-old')
      dispatch('s-old', 'act')
      recordSessionEnd({ sessionId: 's-old', kind: 'closed' })
      backdateSession('s-old', 100)

      await cleanupOlderThan(15)

      const db = getAuditDb()
      expect(db.select().from(toolDispatches).all().length).toBe(0)
      expect(db.select().from(agentSessionStarts).all().length).toBe(0)
      expect(db.select().from(agentSessionEnds).all().length).toBe(0)
    })
  })

  it('lets a concurrent dispatch that lands during cleanup survive as a resurrected session', async () => {
    // Regression coverage for the accepted concurrency behaviour: a
    // dispatch that arrives after cleanupOlderThan has computed its
    // target set but before it commits will end up committed AFTER the
    // deletes finish (WAL serialises writers). The row belongs to a
    // session that we just "deleted", so it resurrects that session in
    // the audit UI, minus its old start/end rows. That's fine: the
    // deriver already handles missing start rows. This test documents
    // the behaviour so a future concurrency guard would surface here.
    await withTempBrowserClawDir(async () => {
      startSession('s-doomed')
      dispatch('s-doomed', 'act')
      backdateSession('s-doomed', 100)

      const cleanupPromise = cleanupOlderThan(15)
      // Kick off a fresh dispatch immediately; bun:sqlite serialises
      // through a single writer so this queues behind the cleanup's
      // transaction and lands after commit.
      const resurrectedId = dispatch('s-doomed', 'act')
      const cleanupResult = await cleanupPromise

      expect(cleanupResult.sessionsDeleted).toBe(1)

      const remaining = getAuditDb()
        .select({ sessionId: toolDispatches.sessionId })
        .from(toolDispatches)
        .all()
        .map((r) => r.sessionId)
      // The doomed session comes back as a "zombie" with only the
      // resurrected dispatch.
      expect(remaining).toEqual(['s-doomed'])
      // And it's the fresh row, not one from before cleanup.
      const rows = getAuditDb()
        .select({ id: toolDispatches.id })
        .from(toolDispatches)
        .all()
      expect(rows.map((r) => r.id)).toEqual([resurrectedId])

      // Session start/end rows are gone (cleanup deleted them and the
      // fresh dispatch does not re-emit a start event).
      expect(getAuditDb().select().from(agentSessionStarts).all().length).toBe(
        0,
      )
    })
  })
})
