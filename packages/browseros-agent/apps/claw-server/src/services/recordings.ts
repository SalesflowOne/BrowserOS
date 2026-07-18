/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import {
  type FileHandle,
  mkdir,
  open,
  readFile,
  rm,
  unlink,
} from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { and, eq, isNotNull, lt, sql } from 'drizzle-orm'
import { resolveClawServerPath } from '../lib/browserclaw-dir'
import { logger } from '../lib/logger'
import { type AuditDb, getAuditDb } from '../modules/db/db'
import { tabClaims } from '../modules/db/schema/tab-claims.sql'
import { tabRecordings } from '../modules/db/schema/tab-recordings.sql'

const RECORDINGS_DIR_NAME = 'recordings'
const MAX_OPEN_HANDLES = 50
const IDLE_HANDLE_MS = 30_000
const RETENTION_INTERVAL_MS = 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

export interface RecordingEventInput {
  ts: number
  type: number
  data: unknown
}

export interface RecordedEvent extends RecordingEventInput {
  tabId: number
}

export interface RetentionSweepResult {
  recordingsDeleted: number
  claimsDeleted: number
}

export interface RecordingStore {
  appendBatch(
    targetId: string,
    tabId: number,
    events: RecordingEventInput[],
  ): Promise<void>
  readRange(
    targetId: string,
    from: number,
    to: number,
  ): Promise<RecordedEvent[]>
  sweepRetention(
    retentionDays: number,
    now?: number,
  ): Promise<RetentionSweepResult>
  resetForTesting(): Promise<void>
}

export interface RecordingStoreOptions {
  rootDir?: string
  maxOpenHandles?: number
  idleHandleMs?: number
  getDb?: () => AuditDb
}

interface OpenEntry {
  handle: FileHandle
  closeTimer: ReturnType<typeof setTimeout> | null
}

/** Stores target-keyed rrweb events and keeps the SQLite catalog in sync. */
export function createRecordingStore(
  options: RecordingStoreOptions = {},
): RecordingStore {
  const maxOpenHandles = options.maxOpenHandles ?? MAX_OPEN_HANDLES
  const idleHandleMs = options.idleHandleMs ?? IDLE_HANDLE_MS
  const getDb = options.getDb ?? getAuditDb
  const openHandles = new Map<string, OpenEntry>()
  const chains = new Map<string, Promise<unknown>>()

  function resolvePath(targetId: string): string {
    const root = options.rootDir ?? resolveClawServerPath(RECORDINGS_DIR_NAME)
    return join(root, `${sanitizeTargetId(targetId)}.ndjson`)
  }

  async function closeEntry(targetId: string): Promise<void> {
    const entry = openHandles.get(targetId)
    if (!entry) return
    openHandles.delete(targetId)
    if (entry.closeTimer) clearTimeout(entry.closeTimer)
    try {
      await entry.handle.close()
    } catch (error) {
      logger.warn('recording handle close failed', {
        targetId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  function bumpIdleTimer(targetId: string): void {
    const entry = openHandles.get(targetId)
    if (!entry) return
    if (entry.closeTimer) clearTimeout(entry.closeTimer)
    entry.closeTimer = setTimeout(() => void closeEntry(targetId), idleHandleMs)
    entry.closeTimer.unref?.()
  }

  async function evictOldestIfNeeded(): Promise<void> {
    while (openHandles.size > maxOpenHandles) {
      const oldestTarget = openHandles.keys().next().value
      if (oldestTarget === undefined) return
      await closeEntry(oldestTarget)
    }
  }

  async function openForAppend(targetId: string): Promise<FileHandle> {
    const existing = openHandles.get(targetId)
    if (existing) {
      openHandles.delete(targetId)
      openHandles.set(targetId, existing)
      bumpIdleTimer(targetId)
      return existing.handle
    }

    const path = resolvePath(targetId)
    await mkdir(dirname(path), { recursive: true })
    const handle = await open(path, 'a')
    openHandles.set(targetId, { handle, closeTimer: null })
    bumpIdleTimer(targetId)
    await evictOldestIfNeeded()
    return handle
  }

  async function append(
    targetId: string,
    tabId: number,
    events: RecordingEventInput[],
  ): Promise<void> {
    if (events.length === 0) return
    const lines = events.map((event) => JSON.stringify({ tabId, ...event }))
    const payload = `${lines.join('\n')}\n`
    let firstEventAt = events[0].ts
    let lastEventAt = events[0].ts
    for (const event of events.slice(1)) {
      firstEventAt = Math.min(firstEventAt, event.ts)
      lastEventAt = Math.max(lastEventAt, event.ts)
    }
    const sizeBytes = Buffer.byteLength(payload)
    const handle = await openForAppend(targetId)
    await handle.appendFile(payload, 'utf8')
    getDb()
      .insert(tabRecordings)
      .values({
        targetId,
        tabId,
        firstEventAt,
        lastEventAt,
        sizeBytes,
        eventCount: events.length,
      })
      .onConflictDoUpdate({
        target: tabRecordings.targetId,
        set: {
          tabId,
          firstEventAt: sql`min(${tabRecordings.firstEventAt}, ${firstEventAt})`,
          lastEventAt: sql`max(${tabRecordings.lastEventAt}, ${lastEventAt})`,
          sizeBytes: sql`${tabRecordings.sizeBytes} + ${sizeBytes}`,
          eventCount: sql`${tabRecordings.eventCount} + ${events.length}`,
        },
      })
      .run()
  }

  function enqueue<T>(
    targetId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const previous = chains.get(targetId) ?? Promise.resolve()
    const next = previous.catch(() => undefined).then(operation)
    const tracked = next.finally(() => {
      if (chains.get(targetId) === tracked) chains.delete(targetId)
    })
    chains.set(targetId, tracked)
    return tracked
  }

  async function deleteIfExpired(
    targetId: string,
    cutoff: number,
  ): Promise<boolean> {
    return enqueue(targetId, async () => {
      const current = getDb()
        .select({ lastEventAt: tabRecordings.lastEventAt })
        .from(tabRecordings)
        .where(eq(tabRecordings.targetId, targetId))
        .get()
      if (!current || current.lastEventAt >= cutoff) return false

      await closeEntry(targetId)
      try {
        await unlink(resolvePath(targetId))
      } catch (error) {
        if ((error as { code?: string }).code !== 'ENOENT') {
          logger.warn('recording retention unlink failed', {
            targetId,
            error: error instanceof Error ? error.message : String(error),
          })
          return false
        }
      }
      getDb()
        .delete(tabRecordings)
        .where(eq(tabRecordings.targetId, targetId))
        .run()
      return true
    })
  }

  return {
    appendBatch(targetId, tabId, events) {
      return enqueue(targetId, () => append(targetId, tabId, events))
    },
    async readRange(targetId, from, to) {
      await chains.get(targetId)?.catch(() => undefined)
      let text: string
      try {
        text = await readFile(resolvePath(targetId), 'utf8')
      } catch (error) {
        if ((error as { code?: string }).code === 'ENOENT') return []
        throw error
      }
      const events: RecordedEvent[] = []
      for (const line of text.split('\n')) {
        if (!line) continue
        const event = parseRecordedEvent(line)
        if (event && event.ts >= from && event.ts <= to) events.push(event)
      }
      return events
    },
    async sweepRetention(retentionDays, now = Date.now()) {
      const cutoff = now - retentionDays * DAY_MS
      const expired = getDb()
        .select({ targetId: tabRecordings.targetId })
        .from(tabRecordings)
        .where(lt(tabRecordings.lastEventAt, cutoff))
        .all()
      let recordingsDeleted = 0
      for (const { targetId } of expired) {
        if (await deleteIfExpired(targetId, cutoff)) recordingsDeleted++
      }
      const expiredClaims = getDb()
        .select({ id: tabClaims.id })
        .from(tabClaims)
        .where(
          and(
            isNotNull(tabClaims.releasedAt),
            lt(tabClaims.releasedAt, cutoff),
          ),
        )
        .all()
      getDb()
        .delete(tabClaims)
        .where(
          and(
            isNotNull(tabClaims.releasedAt),
            lt(tabClaims.releasedAt, cutoff),
          ),
        )
        .run()
      return { recordingsDeleted, claimsDeleted: expiredClaims.length }
    },
    async resetForTesting() {
      await Promise.allSettled(chains.values())
      for (const targetId of [...openHandles.keys()]) {
        await closeEntry(targetId)
      }
      chains.clear()
      if (options.rootDir) {
        await rm(options.rootDir, { recursive: true, force: true })
      }
    },
  }
}

export interface RecordingRetentionHandle {
  initialSweep: Promise<void>
  stop(): void
}

/** Runs recording retention at startup and hourly without keeping Bun alive. */
export function startRecordingRetention(
  store: RecordingStore,
  retentionDays: number,
  intervalMs = RETENTION_INTERVAL_MS,
): RecordingRetentionHandle {
  const run = async (): Promise<void> => {
    try {
      const result = await store.sweepRetention(retentionDays)
      logger.info('recording retention sweep finished', { ...result })
    } catch (error) {
      logger.warn('recording retention sweep failed', {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
  const initialSweep = run()
  const timer = setInterval(() => void run(), intervalMs)
  timer.unref?.()
  return {
    initialSweep,
    stop: () => clearInterval(timer),
  }
}

function sanitizeTargetId(targetId: string): string {
  return targetId.replace(/[^A-Za-z0-9._-]/g, '_')
}

function parseRecordedEvent(line: string): RecordedEvent | null {
  try {
    const event = JSON.parse(line) as Partial<RecordedEvent>
    if (
      typeof event.tabId !== 'number' ||
      typeof event.ts !== 'number' ||
      typeof event.type !== 'number'
    ) {
      return null
    }
    return {
      tabId: event.tabId,
      ts: event.ts,
      type: event.type,
      data: event.data,
    }
  } catch {
    return null
  }
}

export const recordingStore = createRecordingStore()
