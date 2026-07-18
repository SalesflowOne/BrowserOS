/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

export type Fetcher = (
  input: Parameters<typeof globalThis.fetch>[0],
  init?: Parameters<typeof globalThis.fetch>[1],
) => ReturnType<typeof globalThis.fetch>

type TimerHandle = ReturnType<typeof globalThis.setTimeout>

export interface RecordingsRelayOptions {
  resolveServerBaseUrl: () => Promise<string>
  fetch?: Fetcher
  now?: () => number
  warn?: (...args: unknown[]) => void
  setTimeout?: (callback: () => void, delayMs: number) => TimerHandle
  clearTimeout?: (handle: TimerHandle) => void
}

export interface RecordingsRelay {
  post: (tabId: number, ndjson: string) => Promise<void>
  onTabRecoveredAfterLoss: (listener: (tabId: number) => void) => () => void
}

interface QueuedBatch {
  batchId: string
  ndjson: string
  bytes: number
}

type SendOutcome =
  | { kind: 'success' }
  | { kind: 'legacy' }
  | { kind: 'unknown-tab' }
  | { kind: 'transient'; error: unknown }

export const RECORDINGS_QUEUE_MAX_BYTES = 10 * 1024 * 1024
const LEGACY_TTL_MS = 10 * 60_000
const RETRY_INTERVAL_MS = 5_000
const WARNING_INTERVAL_MS = 60_000

/** Relays recorder batches in per-tab order and repairs streams after loss. */
export function createRecordingsRelay(
  options: RecordingsRelayOptions,
): RecordingsRelay {
  const fetch = options.fetch ?? globalThis.fetch
  const now = options.now ?? Date.now
  const warn = options.warn ?? console.warn
  const setTimer = options.setTimeout ?? globalThis.setTimeout
  const clearTimer = options.clearTimeout ?? globalThis.clearTimeout
  const encoder = new TextEncoder()
  const queues = new Map<number, QueuedBatch[]>()
  const queuedBytesByTab = new Map<number, number>()
  const sendingTabs = new Set<number>()
  const sendingQueuedBatchIds = new Set<string>()
  const gappedTabs = new Set<number>()
  const recoveredListeners = new Set<(tabId: number) => void>()
  const lastWarningAt = new Map<string, number>()
  let legacyUntil = 0
  let totalBytes = 0
  let queuedBatchCount = 0
  let retryTimer: TimerHandle | null = null
  let drainPromise: Promise<void> | null = null

  function safeWarn(...args: unknown[]): void {
    try {
      warn(...args)
    } catch {
      // Logging must not change delivery behavior.
    }
  }

  function warnRateLimited(
    kind: string,
    message: string,
    error: unknown,
  ): void {
    const timestamp = now()
    const lastAt = lastWarningAt.get(kind)
    if (lastAt !== undefined && timestamp - lastAt < WARNING_INTERVAL_MS) return
    lastWarningAt.set(kind, timestamp)
    safeWarn(message, {
      error: error instanceof Error ? error.message : String(error),
    })
  }

  function cancelRetry(): void {
    if (retryTimer === null) return
    clearTimer(retryTimer)
    retryTimer = null
  }

  function reportQueueTransition(previousCount: number): void {
    if (previousCount === 0 && queuedBatchCount > 0) {
      safeWarn('[browseros-claw replay] delivery interrupted; events queued')
    } else if (previousCount > 0 && queuedBatchCount === 0) {
      safeWarn('[browseros-claw replay] queued event delivery recovered')
    }
  }

  function addBatch(tabId: number, batch: QueuedBatch, atFront = false): void {
    const previousCount = queuedBatchCount
    const queue = queues.get(tabId)
    if (queue) {
      if (atFront) queue.unshift(batch)
      else queue.push(batch)
    } else {
      queues.set(tabId, [batch])
    }
    queuedBytesByTab.set(
      tabId,
      (queuedBytesByTab.get(tabId) ?? 0) + batch.bytes,
    )
    totalBytes += batch.bytes
    queuedBatchCount++
    reportQueueTransition(previousCount)
    enforceQueueBudget()
  }

  function removeBatchAt(tabId: number, index: number): QueuedBatch | null {
    const queue = queues.get(tabId)
    const batch = queue?.[index]
    if (!queue || !batch) return null
    const previousCount = queuedBatchCount
    queue.splice(index, 1)
    if (queue.length === 0) queues.delete(tabId)
    const remainingBytes = (queuedBytesByTab.get(tabId) ?? 0) - batch.bytes
    if (remainingBytes > 0) queuedBytesByTab.set(tabId, remainingBytes)
    else queuedBytesByTab.delete(tabId)
    totalBytes -= batch.bytes
    queuedBatchCount--
    reportQueueTransition(previousCount)
    if (queuedBatchCount === 0) cancelRetry()
    return batch
  }

  function removeBatch(tabId: number, batchId: string): QueuedBatch | null {
    const index =
      queues.get(tabId)?.findIndex((batch) => batch.batchId === batchId) ?? -1
    return index === -1 ? null : removeBatchAt(tabId, index)
  }

  function clearQueues(): void {
    if (queuedBatchCount === 0) return
    const previousCount = queuedBatchCount
    queues.clear()
    queuedBytesByTab.clear()
    totalBytes = 0
    queuedBatchCount = 0
    reportQueueTransition(previousCount)
    cancelRetry()
  }

  function enforceQueueBudget(): void {
    while (totalBytes > RECORDINGS_QUEUE_MAX_BYTES) {
      let eviction:
        | { tabId: number; batchIndex: number; queuedBytes: number }
        | undefined
      for (const [tabId, queue] of queues) {
        const batchIndex = queue.findIndex(
          (batch) => !sendingQueuedBatchIds.has(batch.batchId),
        )
        if (batchIndex === -1) continue
        const queuedBytes = queuedBytesByTab.get(tabId) ?? 0
        if (!eviction || queuedBytes > eviction.queuedBytes) {
          eviction = { tabId, batchIndex, queuedBytes }
        }
      }
      if (!eviction) return

      // Evict from the largest producer so one hot tab cannot starve all others.
      removeBatchAt(eviction.tabId, eviction.batchIndex)
      gappedTabs.add(eviction.tabId)
      warnRateLimited(
        'queue-eviction',
        '[browseros-claw replay] recording batch evicted under queue pressure',
        `tab ${eviction.tabId}`,
      )
    }
  }

  function makeBatch(ndjson: string): QueuedBatch {
    return {
      batchId: crypto.randomUUID(),
      ndjson,
      bytes: encoder.encode(ndjson).byteLength,
    }
  }

  function notifyRecovered(tabId: number): void {
    if (!gappedTabs.delete(tabId)) return
    for (const listener of recoveredListeners) {
      try {
        listener(tabId)
      } catch (error) {
        warnRateLimited(
          'recovery-listener',
          '[browseros-claw replay] recovery listener failed',
          error,
        )
      }
    }
  }

  function markDeliverySuccess(tabId: number): void {
    lastWarningAt.delete('transient-send')
    notifyRecovered(tabId)
  }

  async function sendBatch(
    tabId: number,
    batch: QueuedBatch,
  ): Promise<SendOutcome> {
    try {
      const baseUrl = await options.resolveServerBaseUrl()
      const response = await fetch(
        `${baseUrl}/recordings/tabs/${tabId}/events`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/x-ndjson',
            'X-Recording-Batch-Id': batch.batchId,
          },
          body: batch.ndjson,
          credentials: 'omit',
        },
      )
      if (response.status === 404) return { kind: 'legacy' }
      if (!response.ok) {
        return {
          kind: 'transient',
          error: new Error(`recordings ingest returned ${response.status}`),
        }
      }
      try {
        const body = (await response.json()) as {
          ok?: unknown
          reason?: unknown
        }
        if (body.ok === false && body.reason === 'unknown tab') {
          return { kind: 'unknown-tab' }
        }
      } catch {
        // Successful ingest responses may not have a JSON body.
      }
      return { kind: 'success' }
    } catch (error) {
      return { kind: 'transient', error }
    }
  }

  function markLegacy(): void {
    legacyUntil = now() + LEGACY_TTL_MS
    clearQueues()
  }

  function armRetry(): void {
    if (queuedBatchCount === 0 || retryTimer !== null) return
    retryTimer = setTimer(() => {
      retryTimer = null
      return drainQueues()
    }, RETRY_INTERVAL_MS)
  }

  async function drainQueues(): Promise<void> {
    if (drainPromise) return drainPromise
    cancelRetry()
    const drain = async () => {
      let progressed = true
      while (progressed && queuedBatchCount > 0 && now() >= legacyUntil) {
        progressed = false
        for (const [tabId, queue] of [...queues]) {
          const batch = queue[0]
          if (!batch || sendingTabs.has(tabId)) continue
          sendingTabs.add(tabId)
          sendingQueuedBatchIds.add(batch.batchId)
          const outcome = await sendBatch(tabId, batch)

          if (outcome.kind === 'transient') {
            sendingTabs.delete(tabId)
            sendingQueuedBatchIds.delete(batch.batchId)
            enforceQueueBudget()
            warnRateLimited(
              'transient-send',
              '[browseros-claw replay] events POST failed',
              outcome.error,
            )
            return
          }

          removeBatch(tabId, batch.batchId)
          sendingTabs.delete(tabId)
          sendingQueuedBatchIds.delete(batch.batchId)
          enforceQueueBudget()
          progressed = true

          if (outcome.kind === 'legacy') {
            markLegacy()
            return
          }
          if (outcome.kind === 'unknown-tab') {
            gappedTabs.add(tabId)
          } else {
            markDeliverySuccess(tabId)
          }
        }
      }
    }

    drainPromise = drain().finally(() => {
      drainPromise = null
      armRetry()
    })
    return drainPromise
  }

  async function post(tabId: number, ndjson: string): Promise<void> {
    try {
      if (now() < legacyUntil) return
      const batch = makeBatch(ndjson)
      if ((queues.get(tabId)?.length ?? 0) > 0 || sendingTabs.has(tabId)) {
        addBatch(tabId, batch)
        await drainQueues()
        return
      }

      sendingTabs.add(tabId)
      const outcome = await sendBatch(tabId, batch)
      sendingTabs.delete(tabId)

      if (outcome.kind === 'legacy') {
        markLegacy()
        return
      }
      if (outcome.kind === 'transient') {
        if (now() >= legacyUntil) addBatch(tabId, batch, true)
        warnRateLimited(
          'transient-send',
          '[browseros-claw replay] events POST failed',
          outcome.error,
        )
        armRetry()
        return
      }
      if (outcome.kind === 'unknown-tab') {
        gappedTabs.add(tabId)
      } else {
        markDeliverySuccess(tabId)
      }

      if ((queues.get(tabId)?.length ?? 0) > 0) await drainQueues()
    } catch (error) {
      sendingTabs.delete(tabId)
      warnRateLimited(
        'relay-internal',
        '[browseros-claw replay] relay failed unexpectedly',
        error,
      )
    }
  }

  return {
    post,
    onTabRecoveredAfterLoss(listener) {
      recoveredListeners.add(listener)
      return () => recoveredListeners.delete(listener)
    },
  }
}
