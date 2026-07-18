import { describe, expect, it } from 'bun:test'
import { Hono } from 'hono'
import { createRecordingsRoute } from '../../../src/routes/recordings'
import app from '../../../src/server'
import type { RecordingEventInput } from '../../../src/services/recordings'

function createFixture(
  targetId: string | null = 'target-a',
  appendResult = true,
) {
  const appended: Array<{
    targetId: string
    tabId: number
    events: RecordingEventInput[]
    batchId?: string
  }> = []
  const route = createRecordingsRoute({
    tabTargets: {
      targetForTab: async () => targetId ?? undefined,
    },
    recordingStore: {
      appendBatch: async (resolvedTargetId, tabId, events, batchId) => {
        appended.push({
          targetId: resolvedTargetId,
          tabId,
          events,
          ...(batchId === undefined ? {} : { batchId }),
        })
        return appendResult
      },
    },
  })
  return { app: new Hono().route('/', route), appended }
}

describe('recordings routes', () => {
  it('reports the feature-detect health contract', async () => {
    const { app } = createFixture()
    const response = await app.request('/recordings/health')

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
  })

  it('accepts valid NDJSON lines and skips malformed events', async () => {
    const { app, appended } = createFixture()
    const response = await app.request('/recordings/tabs/12/events', {
      method: 'POST',
      headers: { 'content-type': 'application/x-ndjson' },
      body: [
        JSON.stringify({ ts: 100, type: 3, data: { id: 1 } }),
        '{bad json',
        JSON.stringify({ type: 3, data: { id: 2 } }),
        JSON.stringify({ ts: 200, type: 2, data: { id: 3 } }),
      ].join('\n'),
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, accepted: 2 })
    expect(appended).toEqual([
      {
        targetId: 'target-a',
        tabId: 12,
        events: [
          { ts: 100, type: 3, data: { id: 1 } },
          { ts: 200, type: 2, data: { id: 3 } },
        ],
      },
    ])
  })

  it('returns the unknown-tab drop contract without writing', async () => {
    const { app, appended } = createFixture(null)
    const response = await app.request('/recordings/tabs/99/events', {
      method: 'POST',
      body: JSON.stringify({ ts: 100, type: 3, data: {} }),
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      ok: false,
      reason: 'unknown tab',
      accepted: 0,
    })
    expect(appended).toEqual([])
  })

  it('forwards batch ids and reports store-detected duplicates as delivered', async () => {
    const { app, appended } = createFixture('target-a', false)
    const response = await app.request('/recordings/tabs/12/events', {
      method: 'POST',
      headers: { 'X-Recording-Batch-Id': 'batch-a' },
      body: JSON.stringify({ ts: 100, type: 3, data: {} }),
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, accepted: 0 })
    expect(appended).toEqual([
      {
        targetId: 'target-a',
        tabId: 12,
        events: [{ ts: 100, type: 3, data: {} }],
        batchId: 'batch-a',
      },
    ])
  })

  it('rejects request bodies over 8 MB', async () => {
    const { app } = createFixture()
    const response = await app.request('/recordings/tabs/12/events', {
      method: 'POST',
      headers: { 'content-length': String(8 * 1024 * 1024 + 1) },
      body: '{}',
    })

    expect(response.status).toBe(413)
  })

  it('does not expose the legacy replay endpoints', async () => {
    const responses = await Promise.all([
      app.fetch(new Request('http://localhost/replay/tabs')),
      app.fetch(new Request('http://localhost/audit/replay/session-a')),
      app.fetch(new Request('http://localhost/audit/replay/session-a/exists')),
      app.fetch(
        new Request('http://localhost/audit/replay/session-a/events', {
          method: 'POST',
        }),
      ),
    ])

    expect(responses.map((response) => response.status)).toEqual([
      404, 404, 404, 404,
    ])
  })
})
