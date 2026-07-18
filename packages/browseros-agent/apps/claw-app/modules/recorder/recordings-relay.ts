/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { Configuration, DefaultApi, type Tab } from '@browseros/claw-api'

export type Fetcher = (
  input: Parameters<typeof globalThis.fetch>[0],
  init?: Parameters<typeof globalThis.fetch>[1],
) => ReturnType<typeof globalThis.fetch>

export interface RecordingsRelayOptions {
  resolveServerBaseUrl: () => Promise<string>
  fetch?: Fetcher
  now?: () => number
  warn?: (...args: unknown[]) => void
}

export interface RecordingsRelay {
  serverHasRecordings: () => Promise<boolean>
  post: (tabId: number, ndjson: string) => Promise<void>
}

const HEALTH_RETRY_MS = 60_000
const WARNING_INTERVAL_MS = 60_000

interface TabAssociation {
  sessionId: string
  pageId: number
  targetId: string
}

interface CanonicalServer {
  baseUrl: string
  client: DefaultApi
  pendingTabs: Tab[] | null
}

/** Relays tab-scoped recorder batches through their current session association. */
export function createRecordingsRelay(
  options: RecordingsRelayOptions,
): RecordingsRelay {
  const fetch = options.fetch ?? globalThis.fetch
  const now = options.now ?? Date.now
  const warn = options.warn ?? console.warn
  let healthyServer: CanonicalServer | null = null
  let unhealthyUntil = 0
  let healthProbe: Promise<CanonicalServer | null> | null = null
  let lastPostFailureWarningAt: number | null = null
  const associations = new Map<number, TabAssociation>()

  async function probeServer(): Promise<CanonicalServer | null> {
    try {
      const baseUrl = await options.resolveServerBaseUrl()
      const client = new DefaultApi(
        new Configuration({ basePath: baseUrl, fetchApi: fetch }),
      )
      const pendingTabs = (await client.listTabs()).items
      healthyServer = { baseUrl, client, pendingTabs }
      unhealthyUntil = 0
      return healthyServer
    } catch {
      unhealthyUntil = now() + HEALTH_RETRY_MS
      return null
    }
  }

  async function resolveHealthyServer(): Promise<CanonicalServer | null> {
    if (healthyServer) return healthyServer
    if (now() < unhealthyUntil) return null
    if (!healthProbe) healthProbe = probeServer()
    const currentProbe = healthProbe
    try {
      return await currentProbe
    } finally {
      if (healthProbe === currentProbe) healthProbe = null
    }
  }

  function markPostFailure(error: unknown): void {
    healthyServer = null
    unhealthyUntil = 0
    const timestamp = now()
    if (
      lastPostFailureWarningAt !== null &&
      timestamp - lastPostFailureWarningAt < WARNING_INTERVAL_MS
    ) {
      return
    }
    lastPostFailureWarningAt = timestamp
    warn('[browseros-claw replay] events POST failed', {
      error: error instanceof Error ? error.message : String(error),
    })
  }

  async function associationForTab(
    server: CanonicalServer,
    tabId: number,
  ): Promise<TabAssociation | null> {
    let tabs: Tab[]
    try {
      tabs = server.pendingTabs ?? (await server.client.listTabs()).items
      server.pendingTabs = null
    } catch {
      healthyServer = null
      unhealthyUntil = now() + HEALTH_RETRY_MS
      associations.delete(tabId)
      return null
    }

    const tab = tabs.find(
      (candidate) =>
        candidate.tabId === tabId && typeof candidate.sessionId === 'string',
    )
    if (!tab?.sessionId) {
      associations.delete(tabId)
      return null
    }
    const association = {
      sessionId: tab.sessionId,
      pageId: tab.pageId,
      targetId: tab.targetId,
    }
    const previous = associations.get(tabId)
    if (
      previous?.sessionId === association.sessionId &&
      previous.pageId === association.pageId &&
      previous.targetId === association.targetId
    ) {
      return previous
    }
    associations.set(tabId, association)
    return association
  }

  return {
    async serverHasRecordings(): Promise<boolean> {
      return (await resolveHealthyServer()) !== null
    },
    async post(tabId, ndjson): Promise<void> {
      const server = await resolveHealthyServer()
      if (!server) return
      const association = await associationForTab(server, tabId)
      if (!association) return
      try {
        const response = await fetch(
          `${server.baseUrl}/api/v1/sessions/${encodeURIComponent(association.sessionId)}/recording/events`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/x-ndjson' },
            body: ndjson,
            credentials: 'omit',
          },
        )
        if (!response.ok) {
          throw new Error(`recordings ingest returned ${response.status}`)
        }
        lastPostFailureWarningAt = null
      } catch (error) {
        markPostFailure(error)
      }
    },
  }
}
