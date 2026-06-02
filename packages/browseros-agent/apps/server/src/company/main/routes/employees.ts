// biome-ignore-all lint/nursery/noExcessiveLinesPerFile: list / detail / hire / patch / fire all share the same hire-schema + serializer + telegram-link / rail-status joins; splitting just to satisfy the cap fragments the surface
import { mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { zValidator } from '@hono/zod-validator'
import { desc, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { nanoid } from 'nanoid'
import { z } from 'zod'
import { type Employee, employees } from '../../db/schema/employees.sql.js'
import { threads } from '../../db/schema/threads.sql.js'
import { isKnownAgentId } from '../agents/detect.js'
import { ensureAppWindow } from '../browseros/app-window.js'
import { createSurfaceTabGroup } from '../browseros/tab-group.js'
import {
  aggregateEmployeeRailStatus,
  computeThreadStatuses,
} from '../chat/rail-status.js'
import { findHireTemplate } from '../data/employee-roles/index.js'
import { getDb } from '../db-singleton.js'
import { seedWorkspace } from '../memory/seed.js'
import { getBrowserosMcpUrl } from '../settings/browseros.js'
import {
  bucketThreadsByEmployee,
  loadTelegramLinks,
  serializeThreadWithLink,
} from '../telegram/thread-links.js'

const tintEnum = z.enum(['orange', 'blue', 'green', 'purple', 'pink', 'teal'])

// The hire payload carries personality fields the user fills in
// during the dialog. Role identity comes from the picked template
// (`templateId`), so the client never supplies `role` directly —
// the route derives it from `template.roleTitle` (or
// `customRoleTitle` for the Custom template). `workspacePath` is
// optional: when the user picks a folder it's honoured verbatim,
// when they leave it blank the server generates a sandbox dir
// under ~/.browserclaw/workspaces/<id>. `modelId` +
// `reasoningEffort` start null and are tuned per-thread via the
// composer's model picker.
const hireSchema = z
  .object({
    templateId: z.string().min(1).max(64),
    name: z.string().min(1).max(100),
    tagline: z.string().max(200).optional(),
    bio: z.string().max(500).optional(),
    monogram: z.string().min(1).max(2),
    tint: tintEnum,
    agentKind: z.string().min(1).max(64).default('claude'),
    managerId: z.string().optional(),
    createdByEmployeeId: z.string().optional(),
    // The directory the employee's agent runs in. The hire dialog
    // lets the user pick any existing folder (e.g. a real project
    // dir like ~/Documents/My SaaS) so the employee can operate on
    // the user's actual files; omitting it falls back to a
    // server-generated sandbox under ~/.browserclaw/workspaces/<id>.
    // Locked after hire — the composer's workspace picker is
    // hidden in v1, so every new thread runs in this directory.
    workspacePath: z.string().min(1).optional(),
    // Required only when templateId === 'blank'. The role-section of
    // the instruction file is built from `customInstructions` for
    // the Custom template instead of `template.instructions`.
    customRoleTitle: z.string().min(1).max(100).optional(),
    customInstructions: z.string().max(4000).optional(),
  })
  .refine(
    (v) =>
      v.templateId !== 'blank' ||
      (Boolean(v.customRoleTitle?.trim()) &&
        Boolean(v.customInstructions?.trim())),
    {
      message:
        'customRoleTitle and customInstructions are required when templateId is "blank"',
    },
  )

const renameSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  role: z.string().min(1).max(100).optional(),
  tagline: z.string().max(200).nullable().optional(),
  bio: z.string().max(500).nullable().optional(),
  tint: tintEnum.optional(),
  monogram: z.string().min(1).max(2).optional(),
})

const managerSchema = z.object({ managerId: z.string().nullable() })

function serialize(row: Employee) {
  const template = findHireTemplate(row.templateId ?? '')
  return {
    ...row,
    hiredAt: row.hiredAt.getTime(),
    createdAt: row.createdAt.getTime(),
    skills: (template?.capabilities.skills ?? []) as string[],
  }
}

async function ensureWorkspace(path: string): Promise<void> {
  await mkdir(path, { recursive: true })
}
// Returns true if an employee row with the given id exists. Used to validate
// manager / creator refs — the column doesn't FK-enforce.
async function employeeExists(
  db: ReturnType<typeof getDb>,
  id: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: employees.id })
    .from(employees)
    .where(eq(employees.id, id))
    .limit(1)
  return rows.length > 0
}

export const employeesRoute = new Hono()
  .get('/employees', async (c) => {
    const db = getDb()
    const rows = await db.select().from(employees).all()
    return c.json(rows.map(serialize))
  })
  // Rail-friendly view: every employee with their N most-recent threads
  // joined in one round-trip plus a thread total so the renderer can
  // size the "Show more" affordance without a second query.
  .get('/employees/with-recent-threads', async (c) => {
    const limit = Math.max(
      1,
      Math.min(50, Number(c.req.query('limit') ?? '5') || 5),
    )
    const db = getDb()
    const [employeeRows, threadRows] = await Promise.all([
      db.select().from(employees).all(),
      db.select().from(threads).orderBy(desc(threads.updatedAt)).all(),
    ])
    const byEmployee = bucketThreadsByEmployee(threadRows)
    // One link lookup for every visible thread so the rail renders
    // the Telegram glyph without a per-employee fan-out. Same shape
    // (one bulk query) for the per-thread rail-status snapshot.
    const allRecentThreadIds = employeeRows.flatMap((e) =>
      (byEmployee.get(e.id) ?? []).slice(0, limit).map((t) => t.id),
    )
    const [links, statuses] = await Promise.all([
      loadTelegramLinks(allRecentThreadIds),
      // Aggregate over the employee's full non-archived thread set —
      // not just the slice. An employee with 100 idle threads + one
      // streaming thread outside the recent window should still flip
      // to "working".
      computeThreadStatuses(
        db,
        employeeRows.flatMap((e) =>
          (byEmployee.get(e.id) ?? []).map((t) => t.id),
        ),
      ),
    ])
    return c.json(
      employeeRows.map((employee) => {
        const employeeThreads = byEmployee.get(employee.id) ?? []
        const employeeSnapshots = employeeThreads
          .map((t) => statuses.get(t.id))
          .filter((s): s is NonNullable<typeof s> => s !== undefined)
        return {
          ...serialize(employee),
          lastActivityAt: employeeThreads[0]?.updatedAt.getTime() ?? null,
          totalThreadCount: employeeThreads.length,
          railStatus: aggregateEmployeeRailStatus(employeeSnapshots),
          recentThreads: employeeThreads.slice(0, limit).map((t) => {
            const base = serializeThreadWithLink(t, links.get(t.id) ?? null)
            const snap = statuses.get(t.id)
            return {
              ...base,
              railStatus: snap?.status ?? 'idle',
              unread: snap?.unread ?? false,
              pending: snap?.pending ?? false,
            }
          }),
        }
      }),
    )
  })
  .get('/employees/:id', async (c) => {
    const db = getDb()
    const id = c.req.param('id')
    const row = await db
      .select()
      .from(employees)
      .where(eq(employees.id, id))
      .limit(1)
    const employee = row[0]
    if (!employee) return c.json({ error: 'not found' }, 404)
    return c.json(serialize(employee))
  })
  .post('/employees', zValidator('json', hireSchema), async (c) => {
    const db = getDb()
    const input = c.req.valid('json')
    if (!isKnownAgentId(input.agentKind)) {
      return c.json({ error: `Unknown agent: ${input.agentKind}` }, 400)
    }
    const template = findHireTemplate(input.templateId)
    if (!template) {
      return c.json({ error: `Unknown template: ${input.templateId}` }, 400)
    }

    // Validate manager / creator refs before touching disk. The FK
    // isn't enforced at the column level, so we check existence
    // here to avoid dangling pointers.
    if (input.managerId && !(await employeeExists(db, input.managerId))) {
      return c.json({ error: 'managerId does not exist' }, 400)
    }
    if (
      input.createdByEmployeeId &&
      !(await employeeExists(db, input.createdByEmployeeId))
    ) {
      return c.json({ error: 'createdByEmployeeId does not exist' }, 400)
    }

    const now = new Date()
    const id = nanoid()
    // User-supplied path wins; fallback is a fresh sandbox dir under
    // the BrowserClaw root. Either way the path is locked on this
    // row after hire — every new thread on this employee runs there.
    const workspacePath =
      input.workspacePath ?? join(homedir(), '.browserclaw', 'workspaces', id)

    // For named templates the role is locked to template.roleTitle.
    // The Custom template carries the user-typed role in
    // `customRoleTitle`; the `.refine` above guarantees it's set
    // when templateId === 'blank'.
    const role =
      input.templateId === 'blank'
        ? (input.customRoleTitle as string)
        : template.roleTitle

    const row: Employee = {
      id,
      name: input.name,
      role,
      tagline: input.tagline ?? null,
      monogram: input.monogram.toUpperCase().slice(0, 2),
      tint: input.tint,
      bio: input.bio ?? null,
      status: 'idle',
      managerId: input.managerId ?? null,
      createdByEmployeeId: input.createdByEmployeeId ?? null,
      agentKind: input.agentKind,
      modelId: null,
      reasoningEffort: null,
      workspacePath,
      templateId: input.templateId,
      customInstructions:
        input.templateId === 'blank'
          ? (input.customInstructions ?? null)
          : null,
      tabGroupId: null,
      hiredAt: now,
      createdAt: now,
    }
    // Seed SOUL.md + the agent-aware instruction file + MEMORY.md +
    // memory/ + life/ subdirs BEFORE the DB insert. If filesystem
    // seeding fails (disk full, permission), the row never gets
    // created — the client can retry cleanly. Reversing the order
    // would leave an orphan employee with no on-disk files.
    await ensureWorkspace(workspacePath)
    await seedWorkspace(row)
    await db.insert(employees).values(row)
    // Eagerly create the employee's tab group inside the shared app
    // window so they show up in the tab strip the moment they're
    // hired, not on the first BrowserOS tool call. Best-effort: if
    // BrowserOS is unreachable the hire still succeeds and the lazy
    // ensure path inside agent-mcp-servers will create the group on
    // the first tool call.
    try {
      const browserosUrl = await getBrowserosMcpUrl(db)
      const appWindowId = await ensureAppWindow(db, browserosUrl)
      const tabGroupId = await createSurfaceTabGroup(
        browserosUrl,
        appWindowId,
        { kind: 'employee', id: row.id, name: row.name, tint: row.tint },
      )
      await db
        .update(employees)
        .set({ tabGroupId })
        .where(eq(employees.id, row.id))
      row.tabGroupId = tabGroupId
    } catch (err) {
      // biome-ignore lint/suspicious/noConsole: tab group bootstrap is non-fatal; lazy ensure will retry on first tool call
      console.warn(
        `[employees.hire] tab group bootstrap failed for ${row.id}; will retry lazily:`,
        err,
      )
    }
    return c.json(serialize(row), 201)
  })
  .patch('/employees/:id', zValidator('json', renameSchema), async (c) => {
    const db = getDb()
    const id = c.req.param('id')
    const input = c.req.valid('json')
    const patch: Partial<Employee> = {}
    if (input.name !== undefined) patch.name = input.name
    if (input.role !== undefined) patch.role = input.role
    if (input.tagline !== undefined) patch.tagline = input.tagline
    if (input.bio !== undefined) patch.bio = input.bio
    if (input.tint !== undefined) patch.tint = input.tint
    if (input.monogram !== undefined) {
      patch.monogram = input.monogram.toUpperCase().slice(0, 2)
    }
    if (Object.keys(patch).length === 0) {
      return c.json({ error: 'no fields to update' }, 400)
    }
    const updated = await db
      .update(employees)
      .set(patch)
      .where(eq(employees.id, id))
      .returning()
    const row = updated[0]
    if (!row) return c.json({ error: 'not found' }, 404)
    // Re-seed so the agent-aware instruction file picks up the new
    // name / tagline / bio. SOUL.md + MEMORY.md keep their existing
    // contents (write-if-missing inside the seeder), only the
    // instruction file gets regenerated.
    await seedWorkspace(row)
    return c.json(serialize(row))
  })
  .delete('/employees/:id', async (c) => {
    const db = getDb()
    const id = c.req.param('id')
    const deleted = await db
      .delete(employees)
      .where(eq(employees.id, id))
      .returning()
    if (deleted.length === 0) return c.json({ error: 'not found' }, 404)
    // Any employees that reported to this one fall back to the founder.
    await db
      .update(employees)
      .set({ managerId: null })
      .where(eq(employees.managerId, id))
    return c.json({ ok: true })
  })
  .patch(
    '/employees/:id/manager',
    zValidator('json', managerSchema),
    async (c) => {
      const db = getDb()
      const id = c.req.param('id')
      const { managerId } = c.req.valid('json')
      if (managerId === id) {
        return c.json({ error: 'employee cannot manage themselves' }, 400)
      }
      const updated = await db
        .update(employees)
        .set({ managerId })
        .where(eq(employees.id, id))
        .returning()
      if (updated.length === 0) return c.json({ error: 'not found' }, 404)
      const row = updated[0]
      if (!row) return c.json({ error: 'not found' }, 404)
      return c.json(serialize(row))
    },
  )
