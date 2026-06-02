import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { z } from 'zod'
import {
  openScreencastProxy,
  type ScreencastProxyHandle,
} from '../browseros/screencast-proxy.js'
import { getDb } from '../db-singleton.js'
import { getBrowserosBaseUrl } from '../settings/browseros.js'

const paramSchema = z.object({
  windowId: z.coerce.number().int().positive(),
})

const querySchema = z.object({
  pageId: z.coerce.number().int().positive().optional(),
})

export const screencastRoute = new Hono().get(
  '/screencast/:windowId',
  zValidator('param', paramSchema),
  zValidator('query', querySchema),
  async (c) => {
    const { windowId } = c.req.valid('param')
    const { pageId } = c.req.valid('query')
    const browserosBaseUrl = await getBrowserosBaseUrl(getDb())
    return streamSSE(c, async (stream) => {
      let proxy: ScreencastProxyHandle | null = null
      await new Promise<void>((resolve) => {
        stream.onAbort(() => {
          proxy?.close()
          resolve()
        })
        proxy = openScreencastProxy({
          browserosBaseUrl,
          windowId,
          pageId,
          onMessage: (data) => {
            void stream.writeSSE({ event: parseEventName(data), data })
          },
          onClose: () => {
            proxy = null
            resolve()
          },
        })
      })
    })
  },
)

function parseEventName(json: string): string {
  try {
    const parsed = JSON.parse(json) as unknown
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'type' in parsed &&
      typeof (parsed as { type: unknown }).type === 'string'
    ) {
      return (parsed as { type: string }).type
    }
  } catch {
    // fall through
  }
  return 'frame'
}
