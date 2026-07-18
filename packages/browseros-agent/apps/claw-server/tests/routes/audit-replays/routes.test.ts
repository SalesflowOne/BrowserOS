import { describe, expect, it } from 'bun:test'
import { Hono } from 'hono'
import { createAuditReplaysRoute } from '../../../src/routes/audit-replays'

describe('audit replay routes', () => {
  it('returns merged NDJSON with the replay content type', async () => {
    const app = new Hono().route(
      '/',
      createAuditReplaysRoute({
        replayService: {
          readSession: async () => [
            {
              sessionId: 'session-a',
              targetId: 'target-a',
              tabId: 1,
              ts: 100,
              type: 3,
              data: {},
            },
          ],
          getMeta: () => ({ exists: false, sizeBytes: 0, targets: [] }),
        },
      }),
    )

    const response = await app.request('/audit/replays/session-a')

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain(
      'application/x-ndjson',
    )
    expect(JSON.parse((await response.text()).trim())).toMatchObject({
      sessionId: 'session-a',
      targetId: 'target-a',
    })
  })

  it('returns 404 when no attributed replay events exist', async () => {
    const app = new Hono().route(
      '/',
      createAuditReplaysRoute({
        replayService: {
          readSession: async () => [],
          getMeta: () => ({ exists: false, sizeBytes: 0, targets: [] }),
        },
      }),
    )

    const response = await app.request('/audit/replays/missing')

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({
      ok: false,
      reason: 'no replay for this session',
    })
  })

  it('returns replay metadata directly', async () => {
    const meta = { exists: false, sizeBytes: 0, targets: [] }
    const app = new Hono().route(
      '/',
      createAuditReplaysRoute({
        replayService: {
          readSession: async () => [],
          getMeta: () => meta,
        },
      }),
    )

    const response = await app.request('/audit/replays/missing/meta')

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(meta)
  })
})
