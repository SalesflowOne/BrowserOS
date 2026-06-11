/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import { Hono } from 'hono'
import { identity } from '../../lib/identity'
import { logger } from '../../lib/logger'
import { mintLaptopJwt } from '../../lib/remote-hermes/auth'
import {
  loadRemoteHermesEnv,
  type RemoteHermesEnv,
  requireConfigured,
} from '../../lib/remote-hermes/env'

/**
 * Lifecycle + status endpoints for the `remote-hermes` provider. Mirrors
 * the worker's VM lifecycle so the agent UI can express user intent
 * without ever having to know about the Cloudflare control plane:
 *   POST /remote-hermes/start    — fired on provider save
 *   POST /remote-hermes/destroy  — fired when the last remote-hermes
 *                                  provider is deleted
 *   GET  /remote-hermes/status   — debug + cold-start poll source for turn.ts
 */
export function createRemoteHermesRoutes() {
  return new Hono()
    .post('/start', async (c) => {
      const env = ensureConfiguredOrSoftFail(c, 'start')
      if (!env) return c.json({ ok: false, reason: 'not_configured' }, 200)
      void fireVmLifecycle('start', env).catch((err) => {
        logger.warn('Remote Hermes warm /vm/start failed', {
          err: err instanceof Error ? err.message : String(err),
        })
      })
      return c.json({ ok: true })
    })
    .post('/destroy', async (c) => {
      const env = ensureConfiguredOrSoftFail(c, 'destroy')
      if (!env) return c.json({ ok: false, reason: 'not_configured' }, 200)
      // Fire-and-forget; the UI removed the provider locally already and
      // we don't want to block the user on a Fly destroy round-trip.
      void fireVmLifecycle('destroy', env).catch((err) => {
        logger.warn('Remote Hermes /vm/destroy failed', {
          err: err instanceof Error ? err.message : String(err),
        })
      })
      return c.json({ ok: true })
    })
    .get('/status', async (c) => {
      const env = loadRemoteHermesEnv()
      try {
        requireConfigured(env)
      } catch (err) {
        return c.json(
          {
            error: 'not_configured',
            message: err instanceof Error ? err.message : String(err),
          },
          500,
        )
      }
      try {
        const browserosId = identity.getBrowserOSId()
        const jwt = await mintLaptopJwt({
          browserosId,
          secret: env.jwtSecret,
        })
        const res = await fetch(`${env.baseUrl}/v1/laptop/vm/status`, {
          headers: { authorization: `Bearer ${jwt}` },
        })
        const body = (await res.json().catch(() => ({}))) as Record<
          string,
          unknown
        >
        return c.json(body, res.status as 200)
      } catch (err) {
        return c.json(
          {
            error: 'upstream_unreachable',
            message: err instanceof Error ? err.message : String(err),
          },
          502,
        )
      }
    })
}

function ensureConfiguredOrSoftFail(
  _c: { json: (b: unknown, status?: number) => Response },
  endpoint: string,
): (RemoteHermesEnv & { jwtSecret: string }) | null {
  const env = loadRemoteHermesEnv()
  try {
    requireConfigured(env)
    return env
  } catch (err) {
    logger.warn(`Remote Hermes /${endpoint} hit but server is not configured`, {
      err: err instanceof Error ? err.message : String(err),
    })
    return null
  }
}

async function fireVmLifecycle(
  action: 'start' | 'destroy',
  env: RemoteHermesEnv & { jwtSecret: string },
): Promise<void> {
  const browserosId = identity.getBrowserOSId()
  const jwt = await mintLaptopJwt({
    browserosId,
    secret: env.jwtSecret,
  })
  const res = await fetch(`${env.baseUrl}/v1/laptop/vm/${action}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${jwt}` },
  })
  logger.info(`Remote Hermes /vm/${action} dispatched`, { status: res.status })
}
