import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import {
  ensureAppWindow,
  getAppWindowVisibility,
} from '../browseros/app-window.js'
import { resolveBrowserBinding } from '../browseros/bindings.js'
import { listTabsForWindow } from '../browseros/list-tabs.js'
import { getDb } from '../db-singleton.js'
import { getBrowserosMcpUrl } from '../settings/browseros.js'

const tabsQuerySchema = z.object({
  surface: z.enum(['employee', 'channel']),
  surfaceId: z.string().min(1),
})

const visibilitySchema = z.object({
  visibility: z.enum(['visible', 'hidden']),
})

export const browserosRoute = new Hono()
  .get('/browseros/app-window', async (c) => {
    const db = getDb()
    const browserosMcpUrl = await getBrowserosMcpUrl(db)
    try {
      const windowId = await ensureAppWindow(db, browserosMcpUrl)
      const visibility = await getAppWindowVisibility(db)
      return c.json({ windowId, visibility, degraded: false as const })
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'browseros unreachable'
      const visibility = await getAppWindowVisibility(db)
      return c.json({
        windowId: null,
        visibility,
        degraded: true as const,
        message,
      })
    }
  })
  .patch(
    '/browseros/app-window/visibility',
    zValidator('json', visibilitySchema),
    (c) => {
      // The company shares the user's existing window — it never hides,
      // shows, or replaces it. Kept as a no-op for backward compatibility;
      // always reports the window as visible.
      return c.json({ visibility: 'visible' as const })
    },
  )
  .get('/browseros/tabs', zValidator('query', tabsQuerySchema), async (c) => {
    const { surface, surfaceId } = c.req.valid('query')
    const db = getDb()
    const browserosMcpUrl = await getBrowserosMcpUrl(db)
    try {
      const binding = await resolveBrowserBinding({
        surface,
        surfaceId,
        db,
        browserosMcpUrl,
      })
      if (!binding) return c.json({ error: 'surface not found' }, 404)
      const tabs = await listTabsForWindow(
        browserosMcpUrl,
        binding.scopeId,
        binding.windowId,
      )
      return c.json({ tabs, degraded: false as const })
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'browseros unreachable'
      return c.json({ tabs: [], degraded: true as const, message })
    }
  })
