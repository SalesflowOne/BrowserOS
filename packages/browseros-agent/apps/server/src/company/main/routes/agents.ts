import { Hono } from 'hono'
import { detectAgents } from '../agents/detect.js'

export const agentsRoute = new Hono().get('/agents/available', async (c) => {
  const results = await detectAgents()
  return c.json(results)
})
