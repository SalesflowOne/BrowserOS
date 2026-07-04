/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Tests for the request-failure log middleware in src/server.ts.
 * Every >=400 response must produce exactly one structured
 * 'request failed' line (warn for 4xx, error for 5xx) regardless of
 * whether the failure was a router 404, a thrown HttpError, or an
 * unhandled error resolved by `app.onError`; sub-400 traffic stays
 * unlogged so polling endpoints cannot flood the rotating log file.
 */

import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { HttpError } from '../../src/lib/errors'
import { logger } from '../../src/lib/logger'
import app from '../../src/server'

// Throw-only fixtures under a /__test namespace so no real endpoint
// is shadowed. Mounted once at module load; the app instance is the
// module-cached singleton every route test shares.
app.get('/__test/boom', () => {
  throw new Error('boom')
})
app.get('/__test/conflict', () => {
  throw new HttpError(409, 'already exists')
})

let warnSpy: ReturnType<typeof spyOn<typeof logger, 'warn'>>
let errorSpy: ReturnType<typeof spyOn<typeof logger, 'error'>>

beforeEach(() => {
  warnSpy = spyOn(logger, 'warn')
  errorSpy = spyOn(logger, 'error')
})

afterEach(() => {
  warnSpy.mockRestore()
  errorSpy.mockRestore()
})

function get(path: string): Promise<Response> {
  return Promise.resolve(app.fetch(new Request(`http://localhost${path}`)))
}

describe('request-failure logging middleware', () => {
  test('successful responses log nothing', async () => {
    const res = await get('/system/health')
    expect(res.status).toBe(200)
    expect(warnSpy).not.toHaveBeenCalled()
    expect(errorSpy).not.toHaveBeenCalled()
  })

  test('router 404 logs one warn with method, path, status, duration', async () => {
    const res = await get('/__test/missing')
    expect(res.status).toBe(404)
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(errorSpy).not.toHaveBeenCalled()
    const [msg, fields] = warnSpy.mock.calls[0] ?? []
    expect(msg).toBe('request failed')
    expect(fields).toMatchObject({
      method: 'GET',
      path: '/__test/missing',
      status: 404,
    })
    expect(fields?.durationMs).toBeGreaterThanOrEqual(0)
  })

  test('thrown HttpError logs one warn with its status', async () => {
    const res = await get('/__test/conflict')
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'already exists' })
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy.mock.calls[0]?.[1]).toMatchObject({
      method: 'GET',
      path: '/__test/conflict',
      status: 409,
    })
  })

  test('unhandled error logs a 500 request line and keeps the onError line', async () => {
    const res = await get('/__test/boom')
    expect(res.status).toBe(500)
    const messages = errorSpy.mock.calls.map((call) => call[0])
    expect(messages).toContain('Unhandled route error')
    expect(messages).toContain('request failed')
    const requestLine = errorSpy.mock.calls.find(
      (call) => call[0] === 'request failed',
    )
    expect(requestLine?.[1]).toMatchObject({
      method: 'GET',
      path: '/__test/boom',
      status: 500,
    })
    expect(requestLine?.[1]?.durationMs).toBeGreaterThanOrEqual(0)
    expect(warnSpy).not.toHaveBeenCalled()
  })
})
