import { eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { z } from 'zod'
import {
  type Announcement,
  announcements,
} from '../../db/schema/announcements.sql.js'
import { employees } from '../../db/schema/employees.sql.js'
import type { DB } from '../../db/types.js'
import { getAnnouncementBus } from './announcementBus.js'

// Shared input shape. The same zod schema gates the MCP tool handler
// and any future internal caller; keeping it in one place means a
// rate-limit guard or audit hook added here is picked up by every
// writer for free.
export const createAnnouncementSchema = z.object({
  employeeId: z.string().min(1).max(64),
  title: z.string().min(4).max(120),
  body: z.string().min(20).max(2000),
  threadId: z.string().min(1).max(64).optional(),
  turnRequestId: z.string().min(1).max(64).optional(),
})

export type CreateAnnouncementInput = z.infer<typeof createAnnouncementSchema>

// Discriminated result so callers can distinguish "the employee row is
// gone" from a thrown error. The MCP tool surfaces the former as a
// tool-result message; throwing would pop a stack trace into the
// renderer's tool block.
export type CreateAnnouncementResult =
  | { ok: true; row: Announcement }
  | { ok: false; reason: 'unknown-employee' }

export async function createAnnouncement(
  db: DB,
  input: CreateAnnouncementInput,
): Promise<CreateAnnouncementResult> {
  const owner = await db
    .select({ id: employees.id })
    .from(employees)
    .where(eq(employees.id, input.employeeId))
    .limit(1)
  if (owner.length === 0) return { ok: false, reason: 'unknown-employee' }

  const row: Announcement = {
    id: nanoid(),
    employeeId: input.employeeId,
    threadId: input.threadId ?? null,
    turnRequestId: input.turnRequestId ?? null,
    title: input.title.trim(),
    body: input.body.trim(),
    postedAt: new Date(),
  }
  await db.insert(announcements).values(row)
  getAnnouncementBus().publish(row)
  return { ok: true, row }
}
