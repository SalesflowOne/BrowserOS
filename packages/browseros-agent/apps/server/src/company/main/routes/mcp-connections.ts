import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import { getDb } from '../db-singleton.js'
import { getBrowserosBaseUrl } from '../settings/browseros.js'

const connectBody = z.object({ toolkit: z.string().min(1) })

const submitApiKeyBody = z.object({
  toolkit: z.string().min(1),
  apiKey: z.string().min(1),
  apiKeyUrl: z.string().url(),
})

interface BrowserosAddResponse {
  success: boolean
  serverName: string
  oauthUrl?: string
  apiKeyUrl?: string
}

// Thin proxy to BrowserOS's /klavis/servers/* routes. Lives in main so
// the renderer doesn't need to know BrowserOS's URL and we never have
// to deal with CORS from file:// in packaged builds.
export const mcpConnectionsRoute = new Hono()
  .post('/api/mcp/connect', zValidator('json', connectBody), async (c) => {
    const { toolkit } = c.req.valid('json')
    const baseUrl = await getBrowserosBaseUrl(getDb())
    try {
      const upstream = await fetch(`${baseUrl}/klavis/servers/add`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serverName: toolkit }),
      })
      if (!upstream.ok) {
        const errBody = (await upstream.json().catch(() => ({}))) as {
          error?: string
        }
        const status = upstream.status >= 500 ? 502 : 400
        return c.json(
          { error: errBody.error ?? `BrowserOS rejected ${toolkit}` },
          status,
        )
      }
      const data = (await upstream.json()) as BrowserosAddResponse
      return c.json({
        toolkit,
        oauthUrl: data.oauthUrl ?? null,
        apiKeyUrl: data.apiKeyUrl ?? null,
      })
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'BrowserOS unreachable'
      return c.json({ error: message }, 502)
    }
  })
  .post(
    '/api/mcp/submit-api-key',
    zValidator('json', submitApiKeyBody),
    async (c) => {
      const { toolkit, apiKey, apiKeyUrl } = c.req.valid('json')
      const baseUrl = await getBrowserosBaseUrl(getDb())
      try {
        const upstream = await fetch(
          `${baseUrl}/klavis/servers/submit-api-key`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              serverName: toolkit,
              apiKey,
              apiKeyUrl,
            }),
          },
        )
        if (!upstream.ok) {
          const errBody = (await upstream.json().catch(() => ({}))) as {
            error?: string
          }
          const status = upstream.status >= 500 ? 502 : 400
          return c.json(
            {
              error: errBody.error ?? `Could not submit API key for ${toolkit}`,
            },
            status,
          )
        }
        return c.json({ toolkit, success: true })
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'BrowserOS unreachable'
        return c.json({ error: message }, 502)
      }
    },
  )
