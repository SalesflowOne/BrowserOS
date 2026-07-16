/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Startup-side entry to the orphan sweep. Deferred so the sweep never
 * delays the HTTP socket going live: main.ts calls this AFTER the
 * server is listening, and the actual sweep runs after a short timer.
 * Split out from audit-cleanup.ts so the startup scheduling can be
 * mocked in tests without touching the sweep implementation.
 */

import { logger } from '../lib/logger'
import { sweepOrphanFiles } from './audit-cleanup'

/** Ms to wait after boot before running the first orphan sweep. */
const STARTUP_SWEEP_DELAY_MS = 30_000

let scheduledForTesting = false

export function scheduleStartupOrphanSweep(): void {
  const timer = setTimeout(() => {
    void runStartupSweep()
  }, STARTUP_SWEEP_DELAY_MS)
  // Do not keep the process alive just for this timer; if the server
  // is shutting down before the sweep fires, we skip this cycle.
  timer.unref?.()
}

/** Exported for testing. Runs the sweep immediately, no delay. */
export async function runStartupSweep(): Promise<void> {
  scheduledForTesting = true
  try {
    const result = await sweepOrphanFiles()
    logger.info('orphan sweep', {
      replayFilesDeleted: result.replayFilesDeleted,
      screenshotFilesDeleted: result.screenshotFilesDeleted,
      bytesFreed: result.bytesFreed,
      source: 'startup',
    })
  } catch (err) {
    // Best-effort maintenance pass; never bubble up.
    logger.warn('orphan sweep failed', {
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

/** Test-only probe: was the startup sweep scheduled / run? */
export function wasStartupSweepInvokedForTesting(): boolean {
  return scheduledForTesting
}

export function resetStartupSweepForTesting(): void {
  scheduledForTesting = false
}
