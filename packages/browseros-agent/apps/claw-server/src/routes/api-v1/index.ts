/**
 * @license
 * Copyright 2026 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Canonical REST boundary shared by BrowserClaw clients and both server
 * implementations. Dependencies expose implementation-neutral operations so
 * route tests and the cross-server suite can run without a browser connection.
 */

import {
  type AppendRecordingEventsResponse,
  type Connection,
  type ConnectionList,
  Harness,
  type RecordingMetadata,
  type SessionDetail,
  type SessionList,
  type SystemInfo,
  type TabList,
  type TelemetryState,
} from '@browseros/claw-api'
import { type Context, Hono } from 'hono'
import { canonicalApiError } from '../../lib/api-error'
import type { RequestContextEnv } from '../../lib/request-id'

export interface BinaryAsset {
  bytes: Uint8Array
  etag?: string
}

export type SessionState = 'live' | 'ended' | 'missing'

export interface CanonicalSessionQuery {
  profileId?: string
  slug?: string
  status?: 'live' | 'done' | 'failed'
  site?: string
  search?: string
  since?: number
  cursor?: number
  limit?: number
}

export interface CanonicalApiDependencies {
  getSystemInfo(): SystemInfo
  getTelemetry(): TelemetryState
  updateTelemetry(consent: boolean): TelemetryState
  listSessions(query: CanonicalSessionQuery): SessionList
  getSession(sessionId: string): SessionDetail | null
  getSessionState(sessionId: string): SessionState
  cancelSession(sessionId: string): number
  getRecording(sessionId: string): RecordingMetadata | null
  downloadRecordingEvents(sessionId: string): Promise<string | null>
  appendRecordingEvents(
    sessionId: string,
    ndjson: string,
  ): Promise<AppendRecordingEventsResponse>
  listTabs(): TabList
  getTabPreview(pageId: number): BinaryAsset | null
  getDispatchScreenshot(dispatchId: number): BinaryAsset | null
  listConnections(): Promise<ConnectionList>
  connectHarness(harness: Harness): Promise<Connection>
  disconnectHarness(harness: Harness): Promise<Connection>
}

const harnesses = new Set<string>(Object.values(Harness))

export function createCanonicalApiRoute(deps: CanonicalApiDependencies) {
  const app = new Hono<RequestContextEnv>()

  app.get('/api/v1/system', (c) => c.json(deps.getSystemInfo()))
  app.get('/api/v1/settings/telemetry', (c) => c.json(deps.getTelemetry()))
  app.put('/api/v1/settings/telemetry', async (c) => {
    const body = await readJson(c.req.raw)
    if (!isConsentBody(body)) {
      return apiError(c, 400, 'invalid_request', 'consent must be a boolean')
    }
    return c.json(deps.updateTelemetry(body.consent))
  })

  app.get('/api/v1/sessions', (c) => {
    const query = parseSessionQuery(c.req.query())
    if ('error' in query) {
      return apiError(c, 400, 'invalid_request', query.error)
    }
    return c.json(deps.listSessions(query))
  })
  app.get('/api/v1/sessions/:sessionId', (c) => {
    const session = deps.getSession(c.req.param('sessionId'))
    if (!session) {
      return apiError(c, 404, 'session_not_found', 'session not found')
    }
    return c.json(session)
  })
  app.post('/api/v1/sessions/:sessionId/cancel', (c) => {
    const sessionId = c.req.param('sessionId')
    const state = deps.getSessionState(sessionId)
    if (state === 'missing') {
      return apiError(c, 404, 'session_not_found', 'session not found')
    }
    if (state === 'ended') {
      return apiError(c, 409, 'session_not_live', 'session is not live')
    }
    return c.json({ cancelled: deps.cancelSession(sessionId) })
  })
  app.get('/api/v1/sessions/:sessionId/recording', (c) => {
    const recording = deps.getRecording(c.req.param('sessionId'))
    if (!recording) {
      return apiError(c, 404, 'session_not_found', 'session not found')
    }
    return c.json(recording)
  })
  app.get('/api/v1/sessions/:sessionId/recording/events', async (c) => {
    const events = await deps.downloadRecordingEvents(c.req.param('sessionId'))
    if (events === null) {
      return apiError(c, 404, 'session_not_found', 'session not found')
    }
    return c.body(events, 200, { 'content-type': 'application/x-ndjson' })
  })
  app.post('/api/v1/sessions/:sessionId/recording/events', async (c) => {
    const sessionId = c.req.param('sessionId')
    const state = deps.getSessionState(sessionId)
    if (state === 'missing') {
      return apiError(c, 404, 'session_not_found', 'session not found')
    }
    if (state === 'ended') {
      return apiError(c, 410, 'session_ended', 'session has ended')
    }
    const contentType = c.req.header('content-type') ?? ''
    if (!contentType.toLowerCase().startsWith('application/x-ndjson')) {
      return apiError(
        c,
        400,
        'invalid_request',
        'content-type must be application/x-ndjson',
      )
    }
    return c.json(
      await deps.appendRecordingEvents(sessionId, await c.req.text()),
    )
  })

  app.get('/api/v1/tabs', (c) => c.json(deps.listTabs()))
  app.get('/api/v1/tabs/:pageId/preview', (c) => {
    const pageId = positiveInteger(c.req.param('pageId'))
    if (pageId === null) {
      return apiError(c, 400, 'invalid_request', 'pageId must be positive')
    }
    const asset = deps.getTabPreview(pageId)
    if (!asset) {
      return apiError(c, 404, 'preview_not_found', 'tab preview not found')
    }
    return binaryResponse(asset, 'private, max-age=0, must-revalidate')
  })
  app.get('/api/v1/dispatches/:dispatchId/screenshot', (c) => {
    const dispatchId = positiveInteger(c.req.param('dispatchId'))
    if (dispatchId === null) {
      return apiError(c, 400, 'invalid_request', 'dispatchId must be positive')
    }
    const asset = deps.getDispatchScreenshot(dispatchId)
    if (!asset) {
      return apiError(
        c,
        404,
        'screenshot_not_found',
        'dispatch screenshot not found',
      )
    }
    return binaryResponse(asset, 'public, max-age=86400, immutable')
  })

  app.get('/api/v1/connections', async (c) =>
    c.json(await deps.listConnections()),
  )
  app.put('/api/v1/connections/:harness', async (c) => {
    const harness = parseHarness(c.req.param('harness'))
    if (!harness) {
      return apiError(c, 404, 'harness_not_found', 'unknown harness')
    }
    return c.json(await deps.connectHarness(harness))
  })
  app.delete('/api/v1/connections/:harness', async (c) => {
    const harness = parseHarness(c.req.param('harness'))
    if (!harness) {
      return apiError(c, 404, 'harness_not_found', 'unknown harness')
    }
    return c.json(await deps.disconnectHarness(harness))
  })

  return app
}

function apiError(
  c: Context<RequestContextEnv, string>,
  status: 400 | 404 | 409 | 410,
  code: string,
  message: string,
) {
  return c.json(canonicalApiError(code, message, c.get('requestId')), status)
}

function binaryResponse(asset: BinaryAsset, cacheControl: string): Response {
  const headers: Record<string, string> = {
    'content-type': 'image/jpeg',
    'cache-control': cacheControl,
  }
  if (asset.etag) headers.etag = `"${asset.etag}"`
  const body = new ArrayBuffer(asset.bytes.byteLength)
  new Uint8Array(body).set(asset.bytes)
  return new Response(body, { headers })
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json()
  } catch {
    return null
  }
}

function isConsentBody(value: unknown): value is { consent: boolean } {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { consent?: unknown }).consent === 'boolean'
  )
}

function positiveInteger(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null
  const value = Number(raw)
  return Number.isSafeInteger(value) && value > 0 ? value : null
}

function parseHarness(raw: string): Harness | null {
  let decoded: string
  try {
    decoded = decodeURIComponent(raw)
  } catch {
    return null
  }
  return harnesses.has(decoded) ? (decoded as Harness) : null
}

function parseSessionQuery(
  query: Record<string, string>,
): CanonicalSessionQuery | { error: string } {
  const rawStatus = query.status
  if (
    rawStatus &&
    rawStatus !== 'live' &&
    rawStatus !== 'done' &&
    rawStatus !== 'failed'
  ) {
    return { error: 'status must be live, done, or failed' }
  }
  const status = rawStatus as CanonicalSessionQuery['status']
  const since = optionalInteger(query.since, 0)
  if (since === false) return { error: 'since must be a non-negative integer' }
  const cursor = optionalInteger(query.cursor, 1)
  if (cursor === false) return { error: 'cursor must be a positive integer' }
  const limit = optionalInteger(query.limit, 1, 100)
  if (limit === false) return { error: 'limit must be between 1 and 100' }
  return {
    ...(query.profileId ? { profileId: query.profileId } : {}),
    ...(query.slug ? { slug: query.slug } : {}),
    ...(status ? { status } : {}),
    ...(query.site ? { site: query.site } : {}),
    ...(query.search ? { search: query.search } : {}),
    ...(typeof since === 'number' ? { since } : {}),
    ...(typeof cursor === 'number' ? { cursor } : {}),
    ...(typeof limit === 'number' ? { limit } : {}),
  }
}

function optionalInteger(
  raw: string | undefined,
  minimum: number,
  maximum = Number.MAX_SAFE_INTEGER,
): number | undefined | false {
  if (raw === undefined) return undefined
  if (!/^\d+$/.test(raw)) return false
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    return false
  }
  return value
}
