import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import { setCurrentFocus } from '../notifications/focus-state.js'

const focusSchema = z
  .object({
    // null when the renderer is on a non-thread route OR the window
    // lost OS focus / visibility. Both cases route through the same
    // setter so the dispatcher can rely on a single source of truth.
    threadId: z.string().min(1).nullable(),
  })
  .strict()

export const focusRoute = new Hono().post(
  '/focus',
  zValidator('json', focusSchema),
  (c) => {
    setCurrentFocus(c.req.valid('json').threadId)
    return c.json({ ok: true })
  },
)
