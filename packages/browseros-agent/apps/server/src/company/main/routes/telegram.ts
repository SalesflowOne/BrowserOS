import { zValidator } from '@hono/zod-validator'
import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { nanoid } from 'nanoid'
import { z } from 'zod'
import { employees } from '../../db/schema/employees.sql.js'
import {
  type TelegramConnection,
  telegramConnections,
} from '../../db/schema/telegram_connections.sql.js'
import { getDb } from '../db-singleton.js'
import { getTelegramManager } from '../telegram/manager.js'
import { encryptSecret } from '../telegram/secrets.js'

const createSchema = z.object({
  name: z.string().min(1).max(80),
  botUsername: z.string().min(1).max(64).optional(),
  botToken: z.string().min(10),
})

// Connection responses never leak the encrypted token blob — clients
// only need the metadata + the bot's runtime status. Encrypted payload
// is read back inside the main process via decryptSecret when the
// manager spins a Chat<>.
interface ConnectionResponse {
  id: string
  employeeId: string
  name: string
  botUsername: string | null
  status: TelegramConnection['status']
  lastError: string | null
  runtime: 'running' | 'starting' | 'stopped'
  createdAt: number
  updatedAt: number
}

function serialize(row: TelegramConnection): ConnectionResponse {
  return {
    id: row.id,
    employeeId: row.employeeId,
    name: row.name,
    botUsername: row.botUsername,
    status: row.status,
    lastError: row.lastError,
    runtime: getTelegramManager().getStatus(row.id),
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  }
}

export const telegramRoute = new Hono()
  .get('/telegram/connections', async (c) => {
    const rows = await getDb().select().from(telegramConnections).all()
    return c.json(rows.map(serialize))
  })
  .get('/employees/:employeeId/telegram/connection', async (c) => {
    const employeeId = c.req.param('employeeId')
    const row = await getDb()
      .select()
      .from(telegramConnections)
      .where(eq(telegramConnections.employeeId, employeeId))
      .get()
    if (!row) return c.json({ error: 'not found' }, 404)
    return c.json(serialize(row))
  })
  .post(
    '/employees/:employeeId/telegram/connection',
    zValidator('json', createSchema),
    async (c) => {
      const db = getDb()
      const employeeId = c.req.param('employeeId')
      const input = c.req.valid('json')

      const employee = await db
        .select({ id: employees.id })
        .from(employees)
        .where(eq(employees.id, employeeId))
        .get()
      if (!employee) return c.json({ error: 'employee not found' }, 404)

      const existing = await db
        .select()
        .from(telegramConnections)
        .where(eq(telegramConnections.employeeId, employeeId))
        .get()
      if (existing) {
        return c.json(
          { error: 'employee already has a telegram connection' },
          409,
        )
      }

      let encryptedToken: string
      try {
        encryptedToken = await encryptSecret(input.botToken)
      } catch (err) {
        return c.json({ error: errorMessage(err) }, 500)
      }

      const now = new Date()
      const row: TelegramConnection = {
        id: nanoid(),
        employeeId,
        name: input.name.trim(),
        botUsername: input.botUsername?.trim() ?? null,
        botTokenEncrypted: encryptedToken,
        status: 'active',
        lastError: null,
        createdAt: now,
        updatedAt: now,
      }
      await db.insert(telegramConnections).values(row)
      void getTelegramManager().start(row)
      return c.json(serialize(row), 201)
    },
  )
  .delete('/telegram/connections/:id', async (c) => {
    const id = c.req.param('id')
    const db = getDb()
    const row = await db
      .select()
      .from(telegramConnections)
      .where(eq(telegramConnections.id, id))
      .get()
    if (!row) return c.json({ error: 'not found' }, 404)
    // Stop the bot before deleting the row so the polling loop doesn't
    // outlive its config. Best-effort: even if stop throws, the row
    // delete still happens — startAll on next boot won't resurrect it.
    await getTelegramManager().stop(id)
    await db.delete(telegramConnections).where(eq(telegramConnections.id, id))
    return c.json({ ok: true })
  })
  .post('/telegram/connections/:id/restart', async (c) => {
    const id = c.req.param('id')
    const row = await getDb()
      .select()
      .from(telegramConnections)
      .where(eq(telegramConnections.id, id))
      .get()
    if (!row) return c.json({ error: 'not found' }, 404)
    void getTelegramManager().restart(row)
    return c.json(serialize(row))
  })

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}
