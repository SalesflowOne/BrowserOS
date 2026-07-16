/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * HTTP surface tests for /audit/cleanup*. Verifies the zod schema
 * rejects out-of-set thresholds and that valid requests round-trip
 * through the service layer with the expected response shape.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { eq } from 'drizzle-orm'
import {
  getAuditDb,
  resetAuditDbForTesting,
  setAuditDbForTesting,
} from '../../../src/modules/db/db'
import { toolDispatches } from '../../../src/modules/db/schema/schema'
import app from '../../../src/server'
import { recordToolDispatch } from '../../../src/services/audit-log'
import { recordSessionStart } from '../../../src/services/session-events'
import { withTempBrowserClawDir } from '../../_helpers/temp-browserclaw-dir'

const MS_PER_DAY = 86_400_000

function seed(sessionId: string): void {
  recordSessionStart({
    sessionId,
    agentId: 'claude-code',
    slug: 'claude-code',
    agentLabel: 'Claude Code',
    clientName: 'claude-code',
    clientVersion: '0.0.0',
  })
  recordToolDispatch({
    agentId: 'claude-code',
    slug: 'claude-code',
    agentLabel: 'Claude Code',
    sessionId,
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
  })
}

function backdate(sessionId: string, daysOld: number): void {
  const target = Date.now() - daysOld * MS_PER_DAY
  getAuditDb()
    .update(toolDispatches)
    .set({ createdAt: target })
    .where(eq(toolDispatches.sessionId, sessionId))
    .run()
}

describe('/audit/cleanup routes', () => {
  beforeEach(() => setAuditDbForTesting())
  afterEach(() => resetAuditDbForTesting())

  it('GET /audit/cleanup/candidates returns three ranges', async () => {
    await withTempBrowserClawDir(async () => {
      const res = await app.request('/audit/cleanup/candidates')
      expect(res.status).toBe(200)
      const body = (await res.json()) as {
        ranges: { olderThanDays: number; sessionCount: number }[]
      }
      expect(body.ranges.map((r) => r.olderThanDays)).toEqual([15, 30, 90])
    })
  })

  it('POST /audit/cleanup deletes eligible sessions and returns counts', async () => {
    await withTempBrowserClawDir(async () => {
      seed('s-old')
      backdate('s-old', 100)
      seed('s-fresh')
      backdate('s-fresh', 5)

      const res = await app.request('/audit/cleanup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ olderThanDays: 15 }),
      })
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.olderThanDays).toBe(15)
      expect(body.sessionsDeleted).toBe(1)
      expect(body.dispatchesDeleted).toBe(1)
    })
  })

  it('POST /audit/cleanup rejects thresholds outside {15,30,90}', async () => {
    await withTempBrowserClawDir(async () => {
      const res = await app.request('/audit/cleanup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ olderThanDays: 7 }),
      })
      expect(res.status).toBe(400)
    })
  })

  it('POST /audit/cleanup rejects a missing body', async () => {
    await withTempBrowserClawDir(async () => {
      const res = await app.request('/audit/cleanup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      })
      expect(res.status).toBe(400)
    })
  })
})
