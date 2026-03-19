/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * OAuth routes for subscription-based LLM provider authentication.
 */

import { Hono } from 'hono'
import { getOAuthProvider } from '../../lib/clients/oauth/providers'
import type { OAuthTokenManager } from '../../lib/clients/oauth/token-manager'
import { logger } from '../../lib/logger'

interface OAuthRouteDeps {
  tokenManager: OAuthTokenManager
}

export function createOAuthRoutes(deps: OAuthRouteDeps) {
  const { tokenManager } = deps

  return new Hono()
    .get('/:provider/start', async (c) => {
      const providerId = c.req.param('provider')
      const redirectBackUrl = c.req.query('redirect')

      const provider = getOAuthProvider(providerId)
      if (!provider) {
        return c.text(`Unknown OAuth provider: ${providerId}`, 400)
      }

      try {
        const authUrl = await tokenManager.generateAuthorizationUrl(
          providerId,
          redirectBackUrl,
        )
        return c.redirect(authUrl)
      } catch (error) {
        logger.error('Failed to start OAuth flow', {
          provider: providerId,
          error: error instanceof Error ? error.message : String(error),
        })
        return c.text('Failed to start authentication. Please try again.', 500)
      }
    })

    .get('/:provider/status', (c) => {
      const providerId = c.req.param('provider')
      const status = tokenManager.getStatus(providerId)
      return c.json(status)
    })

    .delete('/:provider', (c) => {
      const providerId = c.req.param('provider')
      tokenManager.deleteTokens(providerId)
      logger.info('OAuth tokens deleted', { provider: providerId })
      return c.json({ success: true })
    })
}
