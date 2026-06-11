import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { SessionStore } from '../../agent/session-store'
import type { Browser } from '../../browser/browser'
import type { BrowserSession } from '../../browser/core/session'
import { identity } from '../../lib/identity'
import { logger } from '../../lib/logger'
import { metrics } from '../../lib/metrics'
import { getBridge } from '../../lib/remote-hermes/bridge'
import { REMOTE_HERMES_PROVIDER_TYPE } from '../../lib/remote-hermes/constants'
import {
  loadRemoteHermesEnv,
  requireConfigured,
} from '../../lib/remote-hermes/env'
import { streamRemoteHermesTurn } from '../../lib/remote-hermes/turn'
import { Sentry } from '../../lib/sentry'
import { ChatService } from '../services/chat-service'
import type { KlavisProxyRef } from '../services/klavis/strata-proxy'
import { ChatRequestSchema } from '../types'
import { ConversationIdParamSchema } from '../utils/validation'

interface ChatRouteDeps {
  browser: Browser
  browserSession: BrowserSession
  browserosId?: string
  klavisRef?: KlavisProxyRef
  aiSdkDevtoolsEnabled?: boolean
  /** Port the BrowserOS server bound to. Threaded to ACP providers so
   *  the spawned agent can dial back into the local /mcp route. */
  serverPort: number
  /** BrowserOS resources directory. Threaded to ACP providers so the
   *  bundled-Bun launcher under <resourcesDir>/bin/third_party/bun
   *  can be located for built-in adapters (claude / codex). */
  resourcesDir?: string | null
}

export function createChatRoutes(deps: ChatRouteDeps) {
  const { browserosId } = deps

  const sessionStore = new SessionStore()
  const service = new ChatService({
    sessionStore,
    klavisRef: deps.klavisRef,
    browser: deps.browser,
    browserSession: deps.browserSession,
    browserosId,
    aiSdkDevtoolsEnabled: deps.aiSdkDevtoolsEnabled,
    serverPort: deps.serverPort,
    resourcesDir: deps.resourcesDir,
  })

  return new Hono()
    .post('/', zValidator('json', ChatRequestSchema), async (c) => {
      const request = c.req.valid('json')

      // Sentry + metrics (HTTP concerns only)
      Sentry.getCurrentScope().setTag(
        'request-type',
        request.isScheduledTask ? 'schedule' : 'chat',
      )
      Sentry.setContext('request', {
        provider: request.provider,
        model: request.model,
        baseUrl: request.baseUrl
          ? (() => {
              try {
                return new URL(request.baseUrl).origin
              } catch {
                return undefined
              }
            })()
          : undefined,
      })

      metrics.log('chat.request', {
        provider: request.provider,
        model: request.model,
      })

      logger.info('Chat request received', {
        conversationId: request.conversationId,
        provider: request.provider,
        model: request.model,
      })

      if (request.provider === REMOTE_HERMES_PROVIDER_TYPE) {
        const env = loadRemoteHermesEnv()
        try {
          requireConfigured(env)
        } catch (err) {
          logger.warn(
            'Remote Hermes request received but server not configured',
            {
              err: err instanceof Error ? err.message : String(err),
            },
          )
          return c.json(
            {
              error: 'remote_hermes_not_configured',
              message:
                err instanceof Error
                  ? err.message
                  : 'Remote Hermes not configured',
            },
            500,
          )
        }
        const browserosId = identity.getBrowserOSId()
        const bridge = getBridge({
          env,
          browserosId,
          resolveLocalMcpUrl: (server) =>
            server === 'browseros'
              ? `http://127.0.0.1:${deps.serverPort}/mcp`
              : null,
          log: (msg) => logger.debug(`[remote-hermes] ${msg}`),
        })
        return streamRemoteHermesTurn(
          {
            conversationId: request.conversationId,
            message: request.message,
            modelId: request.model,
            abortSignal: c.req.raw.signal,
          },
          {
            env,
            browserosId,
            bridge,
            log: (msg) => logger.debug(`[remote-hermes] ${msg}`),
          },
        )
      }

      return service.processMessage(request, c.req.raw.signal)
    })
    .delete(
      '/:conversationId',
      zValidator('param', ConversationIdParamSchema),
      async (c) => {
        const { conversationId } = c.req.valid('param')
        const result = await service.deleteSession(conversationId)

        if (result.deleted) {
          return c.json({
            success: true,
            message: `Session ${conversationId} deleted`,
            sessionCount: result.sessionCount,
          })
        }

        return c.json(
          { success: false, message: `Session ${conversationId} not found` },
          404,
        )
      },
    )
}
