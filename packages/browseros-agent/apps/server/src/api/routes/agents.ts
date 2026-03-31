/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Agent management routes for OpenClaw Docker instances.
 */

import { Hono } from 'hono'
import { logger } from '../../lib/logger'

interface AgentInstance {
  id: string
  name: string
  status: 'creating' | 'running' | 'stopped' | 'error'
  port: number
  containerId?: string
  createdAt: string
  error?: string
}

const instances = new Map<string, AgentInstance>()

async function isDockerAvailable(): Promise<boolean> {
  try {
    const proc = Bun.spawn(['docker', 'info'], {
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const exitCode = await proc.exited
    return exitCode === 0
  } catch {
    return false
  }
}

async function findAvailablePort(startPort: number): Promise<number> {
  const net = await import('node:net')
  return new Promise((resolve) => {
    const server = net.createServer()
    server.listen(startPort, '127.0.0.1', () => {
      server.close(() => resolve(startPort))
    })
    server.on('error', () => {
      resolve(findAvailablePort(startPort + 1))
    })
  })
}

async function runDocker(
  args: string[],
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(['docker', ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode }
}

export function createAgentsRoutes() {
  return new Hono()
    .get('/', (c) => {
      const agentList = Array.from(instances.values())
      return c.json({ agents: agentList })
    })

    .get('/docker-status', async (c) => {
      const available = await isDockerAvailable()
      return c.json({ available })
    })

    .post('/create', async (c) => {
      const body = await c.req.json<{ name: string }>()
      const name = body.name?.trim()

      if (!name) {
        return c.json({ error: 'Name is required' }, 400)
      }

      if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(name)) {
        return c.json(
          {
            error:
              'Name must start with a letter or number and contain only letters, numbers, dots, hyphens, and underscores',
          },
          400,
        )
      }

      const existing = Array.from(instances.values()).find(
        (i) => i.name === name,
      )
      if (existing) {
        return c.json({ error: `Agent "${name}" already exists` }, 409)
      }

      const dockerAvailable = await isDockerAvailable()
      if (!dockerAvailable) {
        return c.json(
          {
            error:
              'Docker is not available. Install Docker Desktop or OrbStack to create local agents.',
          },
          503,
        )
      }

      const id = crypto.randomUUID()
      const port = await findAvailablePort(18789)
      const containerName = `browseros-claw-${name}`
      const token = crypto.randomUUID()

      const instance: AgentInstance = {
        id,
        name,
        status: 'creating',
        port,
        createdAt: new Date().toISOString(),
      }
      instances.set(id, instance)

      logger.info('Creating OpenClaw agent instance', {
        id,
        name,
        port,
        containerName,
      })

      // Pull image and start container in the background
      ;(async () => {
        try {
          // Pull image
          const pull = await runDocker(['pull', 'openclaw/openclaw:latest'])
          if (pull.exitCode !== 0) {
            throw new Error(`Failed to pull image: ${pull.stderr}`)
          }

          // Run container
          const run = await runDocker([
            'run',
            '-d',
            '--name',
            containerName,
            '-p',
            `127.0.0.1:${port}:18789`,
            '-v',
            `browseros-claw-${name}-data:/home/node/.openclaw`,
            '-e',
            `OPENCLAW_GATEWAY_TOKEN=${token}`,
            'openclaw/openclaw:latest',
          ])

          if (run.exitCode !== 0) {
            throw new Error(`Failed to start container: ${run.stderr}`)
          }

          instance.containerId = run.stdout
          instance.status = 'running'
          logger.info('OpenClaw agent instance started', {
            id,
            containerId: run.stdout.slice(0, 12),
          })
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          instance.status = 'error'
          instance.error = message
          logger.error('Failed to create OpenClaw agent instance', {
            id,
            error: message,
          })
        }
      })()

      return c.json({ agent: instance }, 201)
    })

    .post('/:id/stop', async (c) => {
      const { id } = c.req.param()
      const instance = instances.get(id)

      if (!instance) {
        return c.json({ error: 'Agent not found' }, 404)
      }

      const containerName = `browseros-claw-${instance.name}`

      try {
        await runDocker(['stop', containerName])
        instance.status = 'stopped'
        return c.json({ agent: instance })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return c.json({ error: `Failed to stop agent: ${message}` }, 500)
      }
    })

    .post('/:id/start', async (c) => {
      const { id } = c.req.param()
      const instance = instances.get(id)

      if (!instance) {
        return c.json({ error: 'Agent not found' }, 404)
      }

      const containerName = `browseros-claw-${instance.name}`

      try {
        await runDocker(['start', containerName])
        instance.status = 'running'
        return c.json({ agent: instance })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return c.json({ error: `Failed to start agent: ${message}` }, 500)
      }
    })

    .delete('/:id', async (c) => {
      const { id } = c.req.param()
      const instance = instances.get(id)

      if (!instance) {
        return c.json({ error: 'Agent not found' }, 404)
      }

      const containerName = `browseros-claw-${instance.name}`

      try {
        // Stop and remove container
        await runDocker(['rm', '-f', containerName])
        // Remove volume
        await runDocker([
          'volume',
          'rm',
          `browseros-claw-${instance.name}-data`,
        ])
        instances.delete(id)
        return c.json({ success: true })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return c.json({ error: `Failed to delete agent: ${message}` }, 500)
      }
    })
}
