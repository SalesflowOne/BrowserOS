/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Audit cleanup routes. Two endpoints:
 *   GET  /audit/cleanup/candidates  cheap counts per threshold; UI polls
 *                                   this to know which options to offer
 *   POST /audit/cleanup             destructive delete for one threshold
 *
 * The `olderThanDays` payload is restricted to the three shared
 * thresholds (15/30/90) at the schema layer. Server never trusts a
 * client-supplied cutoff; the UI's typed-confirmation gate is the
 * final human-facing safety, not the API.
 */

import { AUDIT_CLEANUP_THRESHOLD_DAYS } from '@browseros/shared/constants/audit'
import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import { cleanupOlderThan, listCandidates } from '../../services/audit-cleanup'

// z.union of literals from the shared constant. Adding a new threshold
// to the shared array picks up here without touching this file, but the
// tuple annotation is required so TS keeps the union tight instead of
// widening to `z.ZodLiteral<number>`.
const thresholdSchema = z.union(
  AUDIT_CLEANUP_THRESHOLD_DAYS.map((d: number) => z.literal(d)) as [
    z.ZodLiteral<15>,
    z.ZodLiteral<30>,
    z.ZodLiteral<90>,
  ],
)

const cleanupBodySchema = z.object({
  olderThanDays: thresholdSchema,
})

export const auditCleanupRoute = new Hono()
  .get('/audit/cleanup/candidates', (c) => c.json({ ranges: listCandidates() }))
  .post('/audit/cleanup', zValidator('json', cleanupBodySchema), async (c) => {
    const { olderThanDays } = c.req.valid('json')
    const result = await cleanupOlderThan(olderThanDays)
    return c.json(result)
  })
