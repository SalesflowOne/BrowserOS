import { Hono } from 'hono'
import { HIRE_TEMPLATES } from '../data/employee-roles/index.js'

export const templatesRoute = new Hono().get('/templates', (c) =>
  c.json(HIRE_TEMPLATES),
)
