import { Hono } from 'hono'
import { upgradeWebSocket } from 'hono/bun'
import { logger } from '../../lib/logger'
import {
  parseTerminalClientMessage,
  serializeTerminalServerMessage,
} from '../services/terminal/terminal-protocol'
import {
  createTerminalSession,
  listTerminalTargets,
  resolveTerminalTarget,
  type TerminalSession,
} from '../services/terminal/terminal-session'
import type { Env } from '../types'

export const TERMINAL_WS_PATH = '/terminal/ws'

interface TerminalRouteDeps {
  browserosDir: string
  containerName: string
  listRunningContainers?: () => Promise<string[]>
  limaHome: string
  limactlPath: string | (() => string)
  vmName: string
}

interface TerminalRequestTarget {
  target?: string | null
  agentId?: string | null
}

function safeSend(ws: { send(data: string): void }, data: string): void {
  try {
    ws.send(data)
  } catch {}
}

function sendOutput(ws: { send(data: string): void }, data: string): void {
  safeSend(ws, serializeTerminalServerMessage({ type: 'output', data }))
}

function sendError(ws: { send(data: string): void }, message: string): void {
  safeSend(ws, serializeTerminalServerMessage({ type: 'error', message }))
}

function sendExit(ws: { send(data: string): void }, exitCode: number): void {
  safeSend(ws, serializeTerminalServerMessage({ type: 'exit', exitCode }))
}

export function createTerminalSocketEvents(
  deps: TerminalRouteDeps,
  requestTarget: TerminalRequestTarget = {},
) {
  let session: TerminalSession | null = null

  return {
    onOpen(_event: Event, ws: { send(data: string): void; close(): void }) {
      try {
        const limactlPath =
          typeof deps.limactlPath === 'function'
            ? deps.limactlPath()
            : deps.limactlPath
        const target = resolveTerminalTarget({
          browserosDir: deps.browserosDir,
          target: requestTarget.target,
          agentId: requestTarget.agentId,
          openclawContainerName: deps.containerName,
        })
        session = createTerminalSession({
          limaHome: deps.limaHome,
          limactlPath,
          target,
          vmName: deps.vmName,
          onOutput(data) {
            sendOutput(ws, data)
          },
          onExit(exitCode) {
            sendExit(ws, exitCode)
            ws.close()
          },
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        logger.warn('Failed to start terminal session', { error: message })
        sendError(ws, message)
        ws.close()
      }
    },
    onMessage(event: MessageEvent, _ws: { send(data: string): void }) {
      const message = parseTerminalClientMessage(event.data)
      if (!session || !message) return

      if (message.type === 'input') {
        session.writeInput(message.data)
      } else {
        session.resize(message.cols, message.rows)
      }
    },
    onClose() {
      session?.close()
      session = null
    },
    onError(_event: Event, ws: { send(data: string): void; close(): void }) {
      if (!session) return
      session.close()
      session = null
      sendError(ws, 'Terminal connection error')
      ws.close()
    },
  }
}

export function createTerminalRoutes(deps: TerminalRouteDeps) {
  return new Hono<Env>()
    .get('/targets', async (c) => {
      let runningContainers: Set<string> | undefined
      if (deps.listRunningContainers) {
        runningContainers = new Set(await deps.listRunningContainers())
      }
      return c.json({
        targets: listTerminalTargets({
          browserosDir: deps.browserosDir,
          agentId: c.req.query('agentId'),
          runningContainers,
          openclawContainerName: deps.containerName,
        }),
      })
    })
    .get(
      '/ws',
      upgradeWebSocket((c) =>
        createTerminalSocketEvents(deps, {
          target: c.req.query('target'),
          agentId: c.req.query('agentId'),
        }),
      ),
    )
}
