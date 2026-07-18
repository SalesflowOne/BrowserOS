/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { Hono } from 'hono'
import { type ReplayService, replayService } from '../../services/replays'

interface AuditReplaysRouteDeps {
  replayService: ReplayService
}

/** Creates the attributed session replay and metadata read surface. */
export function createAuditReplaysRoute(deps: AuditReplaysRouteDeps) {
  return new Hono()
    .get('/audit/replays/:sessionId', async (c) => {
      const sessionId = c.req.param('sessionId')
      const events = await deps.replayService.readSession(sessionId)
      if (events.length === 0) {
        return c.json({ ok: false, reason: 'no replay for this session' }, 404)
      }
      const body = `${events.map((event) => JSON.stringify(event)).join('\n')}\n`
      return c.body(body, 200, {
        'content-type': 'application/x-ndjson',
      })
    })
    .get('/audit/replays/:sessionId/meta', (c) => {
      return c.json(deps.replayService.getMeta(c.req.param('sessionId')))
    })
}

export const auditReplaysRoute = createAuditReplaysRoute({ replayService })
