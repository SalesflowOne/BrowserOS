/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * User-initiated cleanup of old audit data (SQLite rows + replay files +
 * screenshot files). Three fixed thresholds (15/30/90 days) so the UI
 * copy is stable and the SQL is trivial. "Old" is last-activity based:
 * a session with any dispatch newer than the cutoff survives, even if
 * it started long before. That way a resumed / long-running session is
 * never nuked mid-life.
 *
 * SQL is transactional across all three audit tables. File deletions
 * run AFTER commit and are best-effort. Ordering choice: SQL first
 * means the worst-case failure is orphaned files (harmless, cleaned by
 * the orphan sweep next time), not visible-but-broken sessions in the
 * audit UI.
 */

import { readdirSync, statSync } from 'node:fs'
import { unlink } from 'node:fs/promises'
import {
  AUDIT_CLEANUP_THRESHOLD_DAYS,
  type AuditCleanupThresholdDays,
} from '@browseros/shared/constants/audit'
import { inArray, lt, sql } from 'drizzle-orm'
import { resolveClawServerPath } from '../lib/browserclaw-dir'
import { logger } from '../lib/logger'
import { getAuditDb } from '../modules/db/db'
import {
  agentSessionEnds,
  agentSessionStarts,
  toolDispatches,
} from '../modules/db/schema/schema'
import {
  REPLAY_DIR_NAME,
  REPLAY_FILE_EXTENSION,
  replayStorage,
} from './replay-storage'
import {
  SCREENSHOT_FILE_EXTENSION,
  SCREENSHOTS_DIR_NAME,
  screenshotPath,
} from './screenshots'

const MS_PER_DAY = 86_400_000

/**
 * Files younger than this are skipped by the orphan sweep. Protects
 * fresh writes whose DB row has not flushed yet. 5 minutes is far
 * longer than any realistic write-to-commit delay and short enough
 * that drift stays bounded.
 */
const ORPHAN_MIN_AGE_MS = 5 * 60 * 1000

/**
 * Safety cap on the sweep. Pathological cases (corrupt writer,
 * accidental `cp` of a huge dir) would otherwise scan a million-plus
 * entries and hang the request. When the cap trips we log a warning
 * and return what we processed so the operator sees partial progress
 * instead of a hang.
 */
const MAX_SWEEP_ENTRIES = 100_000

export interface CleanupCandidateStats {
  olderThanDays: AuditCleanupThresholdDays
  sessionCount: number
  dispatchCount: number
  bytesOnDisk: number
}

export interface OrphanSweepResult {
  replayFilesDeleted: number
  screenshotFilesDeleted: number
  bytesFreed: number
}

export interface CleanupResult {
  olderThanDays: AuditCleanupThresholdDays
  sessionsDeleted: number
  dispatchesDeleted: number
  replayFilesDeleted: number
  screenshotFilesDeleted: number
  bytesFreed: number
  orphans: OrphanSweepResult
}

/**
 * Returns one row per configured threshold with the counts the UI needs
 * to decide which options to offer. Ranges with `sessionCount === 0`
 * are still returned so the UI just filters; the endpoint's job is to
 * be predictable, not to hide fields.
 */
export function listCandidates(): CleanupCandidateStats[] {
  return AUDIT_CLEANUP_THRESHOLD_DAYS.map((days) => candidatesFor(days))
}

/** Session/dispatch/byte counts for a single threshold. */
export function candidatesFor(
  days: AuditCleanupThresholdDays,
): CleanupCandidateStats {
  const cutoff = Date.now() - days * MS_PER_DAY
  const sessionIds = eligibleSessionIds(cutoff)
  if (sessionIds.length === 0) {
    return {
      olderThanDays: days,
      sessionCount: 0,
      dispatchCount: 0,
      bytesOnDisk: 0,
    }
  }
  const dispatchIds = dispatchIdsForSessions(sessionIds)
  return {
    olderThanDays: days,
    sessionCount: sessionIds.length,
    dispatchCount: dispatchIds.length,
    bytesOnDisk:
      sumReplayFileBytes(sessionIds) + sumScreenshotFileBytes(dispatchIds),
  }
}

/**
 * Deletes every session whose latest dispatch is older than `days` days.
 * Transactional across the three audit tables. Files unlinked
 * best-effort after commit; a partial file failure leaves orphans that
 * the sweep picks up next time (or on server restart).
 */
export async function cleanupOlderThan(
  days: AuditCleanupThresholdDays,
): Promise<CleanupResult> {
  const cutoff = Date.now() - days * MS_PER_DAY

  // Phase 1: compute the target set BEFORE mutating anything.
  const sessionIds = eligibleSessionIds(cutoff)
  if (sessionIds.length === 0) {
    // Even with nothing age-eligible, sweep orphans. Any file that
    // drifted from the DB by other paths (crashed writer, prior
    // partial failure) still gets picked up here.
    const orphans = await sweepOrphanFiles()
    return {
      olderThanDays: days,
      sessionsDeleted: 0,
      dispatchesDeleted: 0,
      replayFilesDeleted: 0,
      screenshotFilesDeleted: 0,
      bytesFreed: 0,
      orphans,
    }
  }
  const dispatchIds = dispatchIdsForSessions(sessionIds)

  // Phase 2: single SQL transaction. All three tables together, or none.
  const db = getAuditDb()
  db.transaction((tx) => {
    tx.delete(toolDispatches)
      .where(inArray(toolDispatches.sessionId, sessionIds))
      .run()
    tx.delete(agentSessionStarts)
      .where(inArray(agentSessionStarts.sessionId, sessionIds))
      .run()
    tx.delete(agentSessionEnds)
      .where(inArray(agentSessionEnds.sessionId, sessionIds))
      .run()
  })

  // Phase 3: best-effort file cleanup AFTER commit. If a file unlink
  // fails, we count it and move on. An orphaned file is harmless
  // (nothing references it) and safer than surfacing a broken row in
  // the audit UI.
  const replayResult = await unlinkReplayFiles(sessionIds)
  const screenshotResult = await unlinkScreenshotFiles(dispatchIds)

  // Phase 4: sweep any orphans left over from prior partial failures
  // or crashed writers. Snapshot known ids AFTER our own deletes so
  // rows we just removed are not treated as still-referenced.
  const orphans = await sweepOrphanFiles()

  return {
    olderThanDays: days,
    sessionsDeleted: sessionIds.length,
    dispatchesDeleted: dispatchIds.length,
    replayFilesDeleted: replayResult.deleted,
    screenshotFilesDeleted: screenshotResult.deleted,
    bytesFreed: replayResult.bytes + screenshotResult.bytes,
    orphans,
  }
}

/**
 * Removes replay + screenshot files whose id no longer exists in the
 * DB. Bundled into every cleanupOlderThan call and also invoked at
 * server startup so partial failures don't drift over time.
 *
 * Safety guards:
 *   - Skips files younger than ORPHAN_MIN_AGE_MS (protects in-flight writes)
 *   - Strict filename filter: only *.ndjson (replays) or integer *.jpg (screenshots)
 *   - DB-first snapshot: known ids read before scanning disk to avoid TOCTOU
 *   - Best-effort throughout: readdir/stat/unlink failures logged, never throw
 *   - MAX_SWEEP_ENTRIES cap per directory
 */
export async function sweepOrphanFiles(): Promise<OrphanSweepResult> {
  const now = Date.now()
  const db = getAuditDb()

  const knownSessionIds = new Set(
    db
      .selectDistinct({ id: toolDispatches.sessionId })
      .from(toolDispatches)
      .all()
      .map((r) => r.id),
  )
  const knownDispatchIds = new Set(
    db
      .select({ id: toolDispatches.id })
      .from(toolDispatches)
      .all()
      .map((r) => r.id),
  )

  const replayRes = await sweepDir({
    dir: resolveClawServerPath(REPLAY_DIR_NAME),
    ext: REPLAY_FILE_EXTENSION,
    now,
    isReferenced: (basename) => knownSessionIds.has(basename),
    label: 'replays',
  })
  const screenshotRes = await sweepDir({
    dir: resolveClawServerPath(SCREENSHOTS_DIR_NAME),
    ext: SCREENSHOT_FILE_EXTENSION,
    now,
    isReferenced: (basename) => {
      const asInt = Number.parseInt(basename, 10)
      if (!Number.isFinite(asInt) || `${asInt}` !== basename) {
        // Non-integer basename is not something the writer produces;
        // treat as "referenced" so we don't touch it. Foreign files
        // in the screenshots dir are left alone rather than deleted.
        return true
      }
      return knownDispatchIds.has(asInt)
    },
    label: 'screenshots',
  })

  return {
    replayFilesDeleted: replayRes.deleted,
    screenshotFilesDeleted: screenshotRes.deleted,
    bytesFreed: replayRes.bytes + screenshotRes.bytes,
  }
}

interface SweepDirArgs {
  dir: string
  ext: string
  now: number
  isReferenced: (basename: string) => boolean
  label: string
}

async function sweepDir(
  args: SweepDirArgs,
): Promise<{ deleted: number; bytes: number }> {
  let entries: string[]
  try {
    entries = readdirSync(args.dir)
  } catch (err) {
    if (!isMissingFile(err)) {
      logger.warn('orphan sweep readdir failed', {
        dir: args.dir,
        error: err instanceof Error ? err.message : String(err),
      })
    }
    return { deleted: 0, bytes: 0 }
  }

  let deleted = 0
  let bytes = 0
  let scanned = 0
  let truncated = false
  for (const entry of entries) {
    scanned += 1
    if (scanned > MAX_SWEEP_ENTRIES) {
      truncated = true
      break
    }
    if (!entry.endsWith(args.ext)) continue
    const basename = entry.slice(0, -args.ext.length)
    if (args.isReferenced(basename)) continue

    const full = `${args.dir}/${entry}`
    let size = 0
    let mtimeMs = 0
    try {
      const st = statSync(full)
      size = st.size
      mtimeMs = st.mtimeMs
    } catch {
      // File vanished between readdir and stat, or unreadable. Skip.
      continue
    }
    if (args.now - mtimeMs < ORPHAN_MIN_AGE_MS) continue // in-flight guard

    try {
      await unlink(full)
      deleted += 1
      bytes += size
    } catch (err) {
      if (isMissingFile(err)) continue
      logger.warn('orphan sweep unlink failed', {
        dir: args.dir,
        entry,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  if (truncated) {
    logger.warn('orphan sweep truncated', {
      dir: args.dir,
      label: args.label,
      cap: MAX_SWEEP_ENTRIES,
    })
  }

  return { deleted, bytes }
}

function eligibleSessionIds(cutoff: number): string[] {
  const db = getAuditDb()
  const rows = db
    .select({ sessionId: toolDispatches.sessionId })
    .from(toolDispatches)
    .groupBy(toolDispatches.sessionId)
    .having(lt(sql`max(${toolDispatches.createdAt})`, cutoff))
    .all()
  return rows.map((r) => r.sessionId)
}

function dispatchIdsForSessions(sessionIds: string[]): number[] {
  if (sessionIds.length === 0) return []
  const db = getAuditDb()
  const rows = db
    .select({ id: toolDispatches.id })
    .from(toolDispatches)
    .where(inArray(toolDispatches.sessionId, sessionIds))
    .all()
  return rows.map((r) => r.id)
}

function sumReplayFileBytes(sessionIds: string[]): number {
  let total = 0
  for (const sessionId of sessionIds) {
    total += safeFileSize(replayStorage.pathFor(sessionId))
  }
  return total
}

function sumScreenshotFileBytes(dispatchIds: number[]): number {
  let total = 0
  for (const id of dispatchIds) {
    total += safeFileSize(screenshotPath(id))
  }
  return total
}

function safeFileSize(path: string): number {
  try {
    return statSync(path).size
  } catch {
    return 0
  }
}

async function unlinkReplayFiles(
  sessionIds: string[],
): Promise<{ deleted: number; bytes: number }> {
  let deleted = 0
  let bytes = 0
  for (const sessionId of sessionIds) {
    const path = replayStorage.pathFor(sessionId)
    const size = safeFileSize(path)
    try {
      await unlink(path)
      deleted += 1
      bytes += size
    } catch (err) {
      // Missing files count as already-deleted; any other IO error is
      // logged and skipped so a single stubborn file does not fail the
      // whole cleanup.
      if (isMissingFile(err)) {
        continue
      }
      logger.warn('replay unlink failed during audit cleanup', {
        sessionId,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }
  return { deleted, bytes }
}

async function unlinkScreenshotFiles(
  dispatchIds: number[],
): Promise<{ deleted: number; bytes: number }> {
  let deleted = 0
  let bytes = 0
  for (const id of dispatchIds) {
    const path = screenshotPath(id)
    const size = safeFileSize(path)
    try {
      await unlink(path)
      deleted += 1
      bytes += size
    } catch (err) {
      if (isMissingFile(err)) {
        continue
      }
      logger.warn('screenshot unlink failed during audit cleanup', {
        dispatchId: id,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }
  return { deleted, bytes }
}

function isMissingFile(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: string }).code === 'ENOENT'
  )
}
