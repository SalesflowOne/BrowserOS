import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import { PERMISSION_MODES } from '../../shared/permission.js'
import { getDb } from '../db-singleton.js'
import { consumeNavigationIntent } from '../notifications/navigation-intents.js'
import {
  getAutostartSettings,
  saveAutostartSettings,
} from '../settings/autostart.js'
import {
  checkBrowserosMcpUrl,
  getBrowserosMcpUrl,
  saveBrowserosMcpUrl,
} from '../settings/browseros.js'
import { readMcpRegistry, writeMcpRegistry } from '../settings/mcp-registry.js'
import { mcpRegistrySchema } from '../settings/mcp-registry.schema.js'
import {
  getNotificationSettings,
  saveNotificationSettings,
} from '../settings/notifications.js'
import {
  getDefaultPermissionMode,
  saveDefaultPermissionMode,
} from '../settings/permission.js'

const notificationsPatchSchema = z
  .object({
    agentActivity: z.boolean().optional(),
    sound: z.boolean().optional(),
  })
  .refine((v) => v.agentActivity !== undefined || v.sound !== undefined, {
    message: 'At least one notification field is required',
  })

const autostartPatchSchema = z
  .object({
    launchAtLogin: z.boolean().optional(),
  })
  .refine((v) => v.launchAtLogin !== undefined, {
    message: 'At least one autostart field is required',
  })

const settingsPatchSchema = z
  .object({
    browserosMcpUrl: z.string().optional(),
    mcpServers: mcpRegistrySchema.optional(),
    defaultPermissionMode: z.enum(PERMISSION_MODES).optional(),
    notifications: notificationsPatchSchema.optional(),
    autostart: autostartPatchSchema.optional(),
  })
  .refine(
    (value) =>
      value.browserosMcpUrl !== undefined ||
      value.mcpServers !== undefined ||
      value.defaultPermissionMode !== undefined ||
      value.notifications !== undefined ||
      value.autostart !== undefined,
    { message: 'At least one settings field is required' },
  )

const browserosCheckSchema = z.object({
  browserosMcpUrl: z.string(),
})

export const systemRoute = new Hono()
  .get('/health', (c) => c.json({ ok: true }))
  .get('/version', (c) => c.json({ version: '0.0.1' }))
  .get('/system/settings', async (c) => {
    const db = getDb()
    const [
      browserosMcpUrl,
      mcpServers,
      defaultPermissionMode,
      notifications,
      autostart,
    ] = await Promise.all([
      getBrowserosMcpUrl(db),
      readMcpRegistry(db),
      getDefaultPermissionMode(db),
      getNotificationSettings(db),
      getAutostartSettings(db),
    ])
    return c.json({
      browserosMcpUrl,
      mcpServers,
      defaultPermissionMode,
      notifications,
      autostart,
    })
  })
  .patch(
    '/system/settings',
    zValidator('json', settingsPatchSchema),
    async (c) => {
      const input = c.req.valid('json')
      const db = getDb()
      try {
        // Both fields share the same `settings` KV table but live in
        // separate rows. We write sequentially; libsql is a single-writer
        // store so two upserts back-to-back can't interleave with another
        // PATCH against the same row.
        if (input.browserosMcpUrl !== undefined) {
          await saveBrowserosMcpUrl(db, input.browserosMcpUrl)
        }
        if (input.mcpServers !== undefined) {
          await writeMcpRegistry(db, input.mcpServers)
        }
        if (input.defaultPermissionMode !== undefined) {
          await saveDefaultPermissionMode(db, input.defaultPermissionMode)
        }
        if (input.notifications !== undefined) {
          await saveNotificationSettings(db, input.notifications)
        }
        if (input.autostart !== undefined) {
          await saveAutostartSettings(db, input.autostart)
        }
        const [
          browserosMcpUrl,
          mcpServers,
          defaultPermissionMode,
          notifications,
          autostart,
        ] = await Promise.all([
          getBrowserosMcpUrl(db),
          readMcpRegistry(db),
          getDefaultPermissionMode(db),
          getNotificationSettings(db),
          getAutostartSettings(db),
        ])
        return c.json({
          browserosMcpUrl,
          mcpServers,
          defaultPermissionMode,
          notifications,
          autostart,
        })
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Could not save settings'
        return c.json({ error: message }, 400)
      }
    },
  )
  .post(
    '/system/browseros/check',
    zValidator('json', browserosCheckSchema),
    async (c) => {
      const input = c.req.valid('json')
      try {
        const result = await checkBrowserosMcpUrl(input.browserosMcpUrl)
        return c.json(result)
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Could not check BrowserOS'
        return c.json({ error: message }, 400)
      }
    },
  )
  // Drains the pending navigation intent set by main when the user
  // clicks a system notification. The renderer polls this every
  // second; returns `{ path: null }` when there's nothing to route
  // to so the steady-state response is tiny.
  .get('/system/navigation-intents', (c) => {
    return c.json({ path: consumeNavigationIntent() })
  })
  // Parameter-less variant used by the global status banner — reads the
  // saved URL itself so the renderer never has to know what it is.
  .get('/system/browseros/status', async (c) => {
    const browserosMcpUrl = await getBrowserosMcpUrl(getDb())
    const result = await checkBrowserosMcpUrl(browserosMcpUrl)
    return c.json(result)
  })
  // Opens the host's native folder picker, parented to the active window
  // when possible. Returns `path: null` when the user dismisses the panel
  // — distinct from an error, which surfaces as a non-200 response.
  .post('/system/pick-directory', (c) => {
    // The Electron host opened a native folder picker here. The BrowserOS
    // server runtime has no native dialog; workspace paths must be entered
    // directly in the UI. Returns `path: null` (treated as "dismissed").
    return c.json({ path: null })
  })
