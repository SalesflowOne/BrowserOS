/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import {
  Configuration,
  DefaultApi,
  ResponseError,
  type Tab,
} from '@browseros/claw-api'

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
  /**
   * The session/page/target that produced these events, stamped from the
   * tab's last known association at enqueue time (or on first successful
   * tab lookup). A pinned batch whose association no longer matches the
   * tab's live one is dropped rather than written into the session that
   * now owns the tab.
   */
  association?: TabAssociation
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

/**
 * Identity of the recording stream a tab's events belong to, as reported
 * by the canonical tab listing. Chrome tab ids are reused when a tab is
 * reattached to a new session, so this trio — not the tab id — decides
 * where a batch may land: `sessionId` scopes the ingest URL, and the
 * page/target ids travel as headers for the server to re-validate
 * against its live registry (mismatch comes back as 409).
 */
interface TabAssociation {
  sessionId: string
  pageId: number
  targetId: string
}

/**
 * Session-lived delivery boundary between recorder content scripts and the
 * local recordings ingest. It preserves each tab's rrweb order in memory and
 * reports recovered gaps so the background can request a fresh checkpoint.
 */
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
  // Last known association per tab id, kept so batches queued while the
  // server is unreachable pin to the session that produced them, not to
  // whichever session owns the tab once delivery resumes.
  const associations = new Map<number, TabAssociation>()

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
    batch.association ??= associations.get(tabId)
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
      const client = new DefaultApi(
        new Configuration({ basePath: baseUrl, fetchApi: fetch }),
      )
      const tab = (await client.listTabs()).items.find(
        (candidate) =>
          candidate.tabId === tabId && typeof candidate.sessionId === 'string',
      )
      if (!tab?.sessionId) {
        associations.delete(tabId)
        return { kind: 'unknown-tab' }
      }
      const association = rememberAssociation(tabId, tab)
      if (
        batch.association &&
        !associationsMatch(batch.association, association)
      ) {
        // The tab has moved on (new session/page/target) since these
        // events were recorded. Dropping beats leaking one session's
        // events into another's replay; the drain loop marks the gap
        // when it sees the unknown-tab outcome.
        return { kind: 'unknown-tab' }
      }
      batch.association = association
      // Batches enqueued before the tab was first resolved carry no pin;
      // they were recorded under this association, so stamp it now.
      for (const queuedBatch of queues.get(tabId) ?? []) {
        queuedBatch.association ??= association
      }
      const response = await fetch(
        `${baseUrl}/api/v1/sessions/${encodeURIComponent(batch.association.sessionId)}/recording/events`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/x-ndjson',
            'X-Recording-Batch-Id': batch.batchId,
            'X-Recording-Tab-Id': tabId.toString(),
            'X-Recording-Page-Id': association.pageId.toString(),
            'X-Recording-Target-Id': association.targetId,
          },
          body: batch.ndjson,
          credentials: 'omit',
        },
      )
      if ([404, 409, 410].includes(response.status)) {
        // The pinned session cannot take these events any more: gone
        // (404), association drifted server-side (409), or ended (410).
        // Forget the association so the next batch re-resolves the tab.
        associations.delete(tabId)
        return { kind: 'unknown-tab' }
      }
      if (!response.ok) {
        return {
          kind: 'transient',
          error: new Error(`recordings ingest returned ${response.status}`),
        }
      }
      return { kind: 'success' }
    } catch (error) {
      // Only the generated client throws ResponseError, so a 404 here is
      // `listTabs` itself missing — a pre-canonical server. Back off via
      // legacy mode instead of treating every tab as unknown.
      if (error instanceof ResponseError && error.response.status === 404) {
        return { kind: 'legacy' }
      }
      return { kind: 'transient', error }
    }
  }

  function rememberAssociation(tabId: number, tab: Tab): TabAssociation {
    const association = {
      sessionId: tab.sessionId as string,
      pageId: tab.pageId,
      targetId: tab.targetId,
    }
    const previous = associations.get(tabId)
    if (previous && !associationsMatch(previous, association)) {
      // The tab was reattached mid-recording; mark the gap so the next
      // successful delivery fires the recovered listeners and the
      // background re-checkpoints the new stream.
      gappedTabs.add(tabId)
    }
    associations.set(tabId, association)
    return association
  }

  function associationsMatch(
    left: TabAssociation,
    right: TabAssociation,
  ): boolean {
    return (
      left.sessionId === right.sessionId &&
      left.pageId === right.pageId &&
      left.targetId === right.targetId
    )
  }

  function markLegacy(triggeringTabId: number): void {
    // A legacy verdict can outlive the server process that produced it. Keep
    // dropped tabs gapped so a later endpoint can heal them after the TTL.
    gappedTabs.add(triggeringTabId)
    for (const queuedTabId of queues.keys()) gappedTabs.add(queuedTabId)
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
            markLegacy(tabId)
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
      if (now() < legacyUntil) {
        gappedTabs.add(tabId)
        return
      }
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
        markLegacy(tabId)
        return
      }
      if (outcome.kind === 'transient') {
        if (now() >= legacyUntil) addBatch(tabId, batch, true)
        else gappedTabs.add(tabId)
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
