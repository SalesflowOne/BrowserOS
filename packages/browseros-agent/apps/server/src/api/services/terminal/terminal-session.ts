import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { CLAUDE_CONTAINER_NAME } from '@browseros/shared/constants/claude'
import { CODEX_CONTAINER_NAME } from '@browseros/shared/constants/codex'
import {
  HERMES_CONTAINER_HARNESS_DIR,
  HERMES_CONTAINER_NAME,
} from '@browseros/shared/constants/hermes'
import {
  OPENCLAW_CONTAINER_HOME,
  OPENCLAW_GATEWAY_CONTAINER_NAME,
  OPENCLAW_TERMINAL_SHELL,
} from '@browseros/shared/constants/openclaw'
import { resolveVmAgentRuntimePaths } from '../../../lib/agents/acpx-runtime-context'
import { getHermesAgentHomeHostDir } from '../../../lib/agents/hermes/hermes-paths'
import { buildNerdctlCommand } from '../../../lib/container'
import { logger } from '../../../lib/logger'

export const TERMINAL_HOME_DIR = OPENCLAW_CONTAINER_HOME
const DEFAULT_COLS = 80
const DEFAULT_ROWS = 24
const TERMINAL_NAME = 'xterm-256color'

export type TerminalTargetId = 'openclaw' | 'claude' | 'codex' | 'hermes'

export interface TerminalTarget {
  id: TerminalTargetId
  label: string
  containerName: string
  workingDir: string
  shell: string
  env?: Record<string, string>
  running?: boolean
}

interface TerminalSessionDeps {
  limaHome: string
  limactlPath: string
  target: TerminalTarget
  vmName: string
  onExit: (exitCode: number) => void
  onOutput: (data: string) => void
}

export interface TerminalSession {
  close(): void
  resize(cols: number, rows: number): void
  writeInput(data: string): void
}

export function buildTerminalExecCommand(
  limactlPath: string,
  vmName: string,
  target: TerminalTarget,
): string[] {
  return [
    limactlPath,
    'shell',
    vmName,
    '--',
    ...buildNerdctlCommand([
      'exec',
      '-it',
      ...envArgs(target.env),
      '-w',
      target.workingDir,
      target.containerName,
      target.shell,
    ]),
  ]
}

export function resolveTerminalTarget(input: {
  browserosDir: string
  target?: string | null
  agentId?: string | null
  materialize?: boolean
  openclawContainerName?: string
}): TerminalTarget {
  const target = parseTargetId(input.target)
  switch (target) {
    case 'openclaw':
      return {
        id: 'openclaw',
        label: 'OpenClaw gateway',
        containerName:
          input.openclawContainerName ?? OPENCLAW_GATEWAY_CONTAINER_NAME,
        workingDir: OPENCLAW_CONTAINER_HOME,
        shell: OPENCLAW_TERMINAL_SHELL,
      }
    case 'claude': {
      const agentId = requireAgentId(target, input.agentId)
      const paths = resolveVmAgentRuntimePaths({
        browserosDir: input.browserosDir,
        adapter: 'claude',
        agentId,
      })
      if (input.materialize !== false) {
        mkdirSync(paths.agentHome, { recursive: true })
      }
      return {
        id: 'claude',
        label: 'Claude Code runtime',
        containerName: CLAUDE_CONTAINER_NAME,
        workingDir: paths.agentHome,
        shell: '/bin/sh',
        env: {
          AGENT_HOME: paths.agentHome,
          HOME: paths.agentHome,
        },
      }
    }
    case 'codex': {
      const agentId = requireAgentId(target, input.agentId)
      const paths = resolveVmAgentRuntimePaths({
        browserosDir: input.browserosDir,
        adapter: 'codex',
        agentId,
      })
      if (input.materialize !== false) {
        mkdirSync(paths.agentHome, { recursive: true })
        mkdirSync(paths.codexHome, { recursive: true })
      }
      return {
        id: 'codex',
        label: 'Codex runtime',
        containerName: CODEX_CONTAINER_NAME,
        workingDir: paths.agentHome,
        shell: '/bin/sh',
        env: {
          AGENT_HOME: paths.agentHome,
          CODEX_HOME: paths.codexHome,
          HOME: paths.agentHome,
        },
      }
    }
    case 'hermes': {
      const agentId = requireAgentId(target, input.agentId)
      const hostHome = getHermesAgentHomeHostDir({
        browserosDir: input.browserosDir,
        agentId,
      })
      const containerHome = join(HERMES_CONTAINER_HARNESS_DIR, agentId, 'home')
      if (input.materialize !== false) {
        mkdirSync(hostHome, { recursive: true })
      }
      return {
        id: 'hermes',
        label: 'Hermes runtime',
        containerName: HERMES_CONTAINER_NAME,
        workingDir: containerHome,
        shell: '/bin/sh',
        env: {
          HERMES_HOME: containerHome,
        },
      }
    }
  }
}

export function listTerminalTargets(input: {
  browserosDir: string
  agentId?: string | null
  runningContainers?: Set<string>
  openclawContainerName?: string
}): TerminalTarget[] {
  const targets: TerminalTarget[] = []
  for (const target of ['openclaw', 'claude', 'codex', 'hermes'] as const) {
    try {
      const resolved = resolveTerminalTarget({
        browserosDir: input.browserosDir,
        target,
        agentId: input.agentId,
        materialize: false,
        openclawContainerName: input.openclawContainerName,
      })
      const running = input.runningContainers
        ? input.runningContainers.has(resolved.containerName)
        : true
      if (running) targets.push({ ...resolved, running })
    } catch (error) {
      if (!isMissingAgentIdError(error)) throw error
    }
  }
  return targets
}

export function buildTerminalEnv(limaHome: string): NodeJS.ProcessEnv {
  return { ...process.env, LIMA_HOME: limaHome, TERM: TERMINAL_NAME }
}

export function createTerminalSession(
  deps: TerminalSessionDeps,
): TerminalSession {
  const decoder = new TextDecoder()
  const proc = Bun.spawn(
    buildTerminalExecCommand(deps.limactlPath, deps.vmName, deps.target),
    {
      cwd: '/',
      terminal: {
        cols: DEFAULT_COLS,
        rows: DEFAULT_ROWS,
        data(_terminal, data) {
          const chunk = decoder.decode(data, { stream: true })
          if (chunk) deps.onOutput(chunk)
        },
      },
      env: buildTerminalEnv(deps.limaHome),
    },
  )
  let closed = false

  void proc.exited.then((exitCode) => {
    const trailing = decoder.decode()
    if (trailing) deps.onOutput(trailing)
    deps.onExit(exitCode)
  })

  logger.debug('Terminal session created', {
    target: deps.target.id,
    workingDir: deps.target.workingDir,
  })

  return {
    writeInput(data) {
      proc.terminal?.write(data)
    },
    resize(cols, rows) {
      proc.terminal?.resize(cols, rows)
    },
    close() {
      if (closed) return
      closed = true
      try {
        proc.terminal?.close()
        proc.kill()
      } catch {
        logger.debug('Terminal session cleanup failed')
      }
      logger.debug('Terminal session destroyed')
    },
  }
}

function parseTargetId(value: string | null | undefined): TerminalTargetId {
  if (!value) return 'openclaw'
  if (
    value === 'openclaw' ||
    value === 'claude' ||
    value === 'codex' ||
    value === 'hermes'
  ) {
    return value
  }
  throw new Error(`Unknown terminal target: ${value}`)
}

function requireAgentId(
  target: TerminalTargetId,
  value: string | null | undefined,
): string {
  const agentId = value?.trim()
  if (!agentId) {
    throw new Error(`agentId is required for ${target} terminal`)
  }
  if (
    agentId === '.' ||
    agentId === '..' ||
    agentId.includes('/') ||
    agentId.includes('\\')
  ) {
    throw new Error('Invalid terminal agentId')
  }
  return agentId
}

function envArgs(env: Record<string, string> | undefined): string[] {
  if (!env) return []
  return Object.entries(env)
    .sort(([left], [right]) => left.localeCompare(right))
    .flatMap(([key, value]) => ['-e', `${key}=${value}`])
}

function isMissingAgentIdError(error: unknown): boolean {
  return error instanceof Error && error.message.includes('agentId is required')
}
