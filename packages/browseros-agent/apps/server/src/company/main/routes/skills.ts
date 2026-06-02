import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { getDb } from '../db-singleton.js'
import {
  discoverExternalSkills,
  getInstalledSkillRow,
  installUserSkill,
  previewSkillSource,
  setUserSkillDisabled,
  snapshot,
  uninstallUserSkill,
} from '../skills/service.js'
import {
  installSkillSchema,
  previewSkillSchema,
  setDisabledSchema,
} from './skills.schema.js'

// Manages the user-installed skills surface. Built-in skills are
// inserted/maintained by `ensure-built-ins.ts` at boot time and never
// touched by this route — every endpoint here filters or refuses
// built-ins so they stay invisible from the renderer.
export const skillsRoute = new Hono()
  .get('/skills', async (c) => {
    const db = getDb()
    const skills = await snapshot(db)
    return c.json({ skills })
  })
  .get('/skills/built-ins', async (c) => {
    const db = getDb()
    const all = await snapshot(db, { includeBuiltIn: true })
    return c.json({ skills: all.filter((s) => s.origin === 'built-in') })
  })
  .get('/skills/external', async (c) => {
    const skills = await discoverExternalSkills()
    return c.json({ skills })
  })
  .post(
    '/skills/preview',
    zValidator('json', previewSkillSchema),
    async (c) => {
      const db = getDb()
      const { source } = c.req.valid('json')
      try {
        const skills = await previewSkillSource(db, source.trim())
        return c.json({ skills })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'preview failed'
        return c.json({ error: message }, 400)
      }
    },
  )
  .post('/skills', zValidator('json', installSkillSchema), async (c) => {
    const db = getDb()
    const { source, names } = c.req.valid('json')
    try {
      const { installed, conflicts } = await installUserSkill(
        db,
        source.trim(),
        names,
      )
      const skills = await snapshot(db)
      return c.json({ skills, justInstalled: installed, conflicts }, 201)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'install failed'
      return c.json({ error: message }, 400)
    }
  })
  .patch('/skills/:name', zValidator('json', setDisabledSchema), async (c) => {
    const db = getDb()
    const name = c.req.param('name')
    const { disabled } = c.req.valid('json')
    const row = await getInstalledSkillRow(db, name)
    if (!row) return c.json({ error: 'skill not found' }, 404)
    if (row.origin !== 'user') {
      return c.json({ error: 'built-in skills are managed by the app' }, 403)
    }
    try {
      await setUserSkillDisabled(db, name, disabled)
      const skills = await snapshot(db)
      return c.json({ skills })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'patch failed'
      return c.json({ error: message }, 500)
    }
  })
  .delete('/skills/:name', async (c) => {
    const db = getDb()
    const name = c.req.param('name')
    const row = await getInstalledSkillRow(db, name)
    if (!row) return c.json({ error: 'skill not found' }, 404)
    if (row.origin !== 'user') {
      return c.json({ error: 'built-in skills are managed by the app' }, 403)
    }
    try {
      await uninstallUserSkill(db, name)
      const skills = await snapshot(db)
      return c.json({ skills })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'uninstall failed'
      return c.json({ error: message }, 500)
    }
  })
