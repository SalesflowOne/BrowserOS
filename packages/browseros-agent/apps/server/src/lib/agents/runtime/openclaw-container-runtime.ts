/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { join } from 'node:path'
import {
  OPENCLAW_GATEWAY_CONTAINER_NAME,
  OPENCLAW_GATEWAY_CONTAINER_PORT,
  OPENCLAW_IMAGE,
} from '@browseros/shared/constants/openclaw'
import { getOpenClawStateEnvPath } from '../../../api/services/openclaw/openclaw-env'
import { getBrowserosDir, getOpenClawDir } from '../../browseros-dir'
import { ContainerCli } from '../../container/container-cli'
import { ImageLoader } from '../../container/image-loader'
import type {
  ContainerDescriptor,
  ManagedContainerDeps,
  MountRoot,
} from '../../container/managed'
import type { ContainerSpec, LogFn } from '../../container/types'
import { logger } from '../../logger'
import {
  GUEST_VM_STATE,
  getLimaHomeDir,
  resolveBundledLimactl,
  resolveBundledLimaTemplate,
  VM_NAME,
  VmRuntime,
} from '../../vm'
import type {
  PrepareAcpxAgentContextInput,
  PreparedAcpxAgentContext,
} from '../acpx-agent-adapter'
import {
  buildBrowserosAcpPrompt,
  ensureUsableCwd,
  resolveAgentRuntimePaths,
} from '../acpx-runtime-context'
import { ContainerAgentRuntime } from './container-agent-runtime'
import { getAgentRuntimeRegistry } from './registry'
import type { ExecSpec } from './types'

const GATEWAY_CONTAINER_HOME = '/home/node'
const GATEWAY_STATE_DIR = `${GATEWAY_CONTAINER_HOME}/.openclaw`
const GUEST_OPENCLAW_HOME = `${GUEST_VM_STATE}/openclaw`
const GATEWAY_NPM_PREFIX = `${GATEWAY_CONTAINER_HOME}/.npm-global`
const GATEWAY_PATH = [
  `${GATEWAY_NPM_PREFIX}/bin`,
  '/usr/local/sbin',
  '/usr/local/bin',
  '/usr/sbin',
  '/usr/bin',
  '/sbin',
  '/bin',
].join(':')

const OPENCLAW_BROWSEROS_ACP_INSTRUCTIONS =
  '<role>You are running inside BrowserOS through the OpenClaw ACP adapter. Use your OpenClaw identity, memory, and browser tools.</role>'

export interface OpenClawContainerRuntimeConfig {
  /** BrowserOS state root. */
  browserosDir: string
  /** OpenClaw state dir (`<browserosDir>/vm/openclaw`). */
  openclawDir: string
  /** Returns the currently allocated host port. Read at spec-build time
   *  so the service can update the port without re-creating the runtime. */
  getHostPort: () => number
}

export class OpenClawContainerRuntime extends ContainerAgentRuntime {
  readonly descriptor: ContainerDescriptor & { kind: 'container' } = {
    adapterId: 'openclaw',
    displayName: 'OpenClaw',
    kind: 'container',
    defaultImage: process.env.OPENCLAW_IMAGE?.trim() || OPENCLAW_IMAGE,
    containerName: OPENCLAW_GATEWAY_CONTAINER_NAME,
    platforms: ['darwin'],
    readinessProbe: { timeoutMs: 60_000, intervalMs: 1_000 },
  }

  private readonly openclawConfig: OpenClawContainerRuntimeConfig

  constructor(
    deps: ManagedContainerDeps,
    config: OpenClawContainerRuntimeConfig,
  ) {
    super(deps)
    this.openclawConfig = config
  }

  // ── ManagedContainer abstracts ───────────────────────────────────

  protected mountRoots(): readonly MountRoot[] {
    return [
      {
        hostPath: this.openclawConfig.openclawDir,
        containerPath: GATEWAY_CONTAINER_HOME,
        kind: 'shared',
      },
    ]
  }

  protected async buildContainerSpec(): Promise<ContainerSpec> {
    const hostPort = this.openclawConfig.getHostPort()
    const envFilePath = getOpenClawStateEnvPath(this.openclawConfig.openclawDir)
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
    const gateway = await this.deps.vm.getDefaultGateway()
    return {
      name: OPENCLAW_GATEWAY_CONTAINER_NAME,
      image: this.descriptor.defaultImage,
      restart: 'unless-stopped',
      ports: [
        {
          hostIp: '127.0.0.1',
          hostPort,
          containerPort: OPENCLAW_GATEWAY_CONTAINER_PORT,
        },
      ],
      envFile: this.translateHostPathToGuest(envFilePath),
      env: this.buildGatewayEnv(timezone),
      mounts: [{ source: GUEST_OPENCLAW_HOME, target: GATEWAY_CONTAINER_HOME }],
      addHosts: [`host.containers.internal:${gateway}`],
      health: {
        cmd: `curl -sf http://127.0.0.1:${OPENCLAW_GATEWAY_CONTAINER_PORT}/healthz`,
        interval: '30s',
        timeout: '10s',
        retries: 3,
      },
      command: [
        'node',
        'dist/index.js',
        'gateway',
        '--bind',
        'lan',
        '--port',
        String(OPENCLAW_GATEWAY_CONTAINER_PORT),
        '--allow-unconfigured',
      ],
    }
  }

  protected async readinessProbe(): Promise<boolean> {
    const hostPort = this.openclawConfig.getHostPort()
    try {
      const res = await fetch(`http://127.0.0.1:${hostPort}/readyz`)
      return res.ok
    } catch {
      return false
    }
  }

  // ── AgentRuntime additions ───────────────────────────────────────

  getPerAgentHomeDir(_agentId: string): string {
    return this.openclawConfig.openclawDir
  }

  /** Build the ExecSpec for `openclaw acp` inside the gateway container. */
  getAcpExecSpec(input: {
    commandEnv: Record<string, string>
    openclawSessionKey: string | null
  }): ExecSpec {
    const argv: [string, ...string[]] = ['openclaw', 'acp']
    argv.push('--url', `ws://127.0.0.1:${OPENCLAW_GATEWAY_CONTAINER_PORT}`)
    const bridgeSessionKey = normalizeBridgeSessionKey(input.openclawSessionKey)
    if (bridgeSessionKey) argv.push('--session', bridgeSessionKey)
    return {
      argv,
      env: {
        OPENCLAW_HIDE_BANNER: '1',
        OPENCLAW_SUPPRESS_NOTES: '1',
        ...input.commandEnv,
      },
    }
  }

  prepareTurnContext(
    input: PrepareAcpxAgentContextInput,
  ): Promise<PreparedAcpxAgentContext> {
    return prepareOpenClawContext(input)
  }

  // ── OpenClaw-specific surface kept on the runtime ────────────────

  /** Compatibility shim for `OpenClawCliClient`'s `ContainerExecutor`
   *  interface — runs argv inside the gateway container and returns
   *  the exit code. */
  async execInContainer(command: string[], onLog?: LogFn): Promise<number> {
    return this.deps.cli.exec(this.descriptor.containerName, command, onLog)
  }

  /** Same as `getLogs(tail)` but routes through the underlying CLI's
   *  raw command runner so callers that want both stdout + stderr in
   *  one call can use this instead. */
  async runInContainer(
    command: string[],
  ): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    return this.deps.cli.runCommand([
      'exec',
      this.descriptor.containerName,
      ...command,
    ])
  }

  /** VM-level halt — kept on the runtime so `OpenClawService.shutdown`
   *  has a single dependency to call. */
  async stopVm(): Promise<void> {
    await this.deps.vm.stopVm()
  }

  async getMachineStatus(): Promise<{
    initialized: boolean
    running: boolean
  }> {
    const running = await this.deps.vm.isReady()
    return { initialized: running, running }
  }

  isHealthy(): Promise<boolean> {
    const hostPort = this.openclawConfig.getHostPort()
    return fetchOk(`http://127.0.0.1:${hostPort}/healthz`)
  }

  /** Public proxy for the readiness probe so callers don't need to
   *  reach into the protected method. */
  isReady(): Promise<boolean> {
    return this.readinessProbe()
  }

  // ── Internals ────────────────────────────────────────────────────

  private buildGatewayEnv(timezone: string): Record<string, string> {
    return {
      HOME: GATEWAY_CONTAINER_HOME,
      OPENCLAW_HOME: GATEWAY_CONTAINER_HOME,
      OPENCLAW_STATE_DIR: GATEWAY_STATE_DIR,
      OPENCLAW_NO_RESPAWN: '1',
      NODE_COMPILE_CACHE: '/var/tmp/openclaw-compile-cache',
      NODE_ENV: 'production',
      TZ: timezone,
      PATH: GATEWAY_PATH,
      NPM_CONFIG_PREFIX: GATEWAY_NPM_PREFIX,
      OPENCLAW_GATEWAY_PRIVATE_INGRESS_NO_AUTH: '1',
    }
  }

  private translateHostPathToGuest(hostPath: string): string {
    const root = this.openclawConfig.openclawDir
    if (hostPath === root) return GUEST_OPENCLAW_HOME
    if (hostPath.startsWith(`${root}/`)) {
      return `${GUEST_OPENCLAW_HOME}${hostPath.slice(root.length)}`
    }
    // Fall back to the generic VM path translation. acpx-side callers
    // never pass paths outside openclawDir today, but the legacy
    // implementation tolerated it so we mirror the behaviour.
    return hostPath
  }
}

async function fetchOk(url: string): Promise<boolean> {
  try {
    const res = await fetch(url)
    return res.ok
  } catch {
    return false
  }
}

/** Normalize an acpx session key into the form OpenClaw expects on
 *  `--session`: must start with `agent:` and be alphanumeric/dash. */
function normalizeBridgeSessionKey(sessionKey: string | null): string | null {
  if (!sessionKey) return null
  if (sessionKey.startsWith('agent:')) return sessionKey
  return `agent:main:${sessionKey.replace(/[^a-zA-Z0-9-]/g, '-')}`
}

/** Prepare OpenClaw without BrowserOS SOUL/MEMORY or BrowserOS MCP. */
export async function prepareOpenClawContext(
  input: PrepareAcpxAgentContextInput,
): Promise<PreparedAcpxAgentContext> {
  const paths = resolveAgentRuntimePaths({
    browserosDir: input.browserosDir,
    agentId: input.agent.id,
  })
  await ensureUsableCwd(paths.effectiveCwd, true)
  return {
    cwd: paths.effectiveCwd,
    runtimeSessionKey: input.sessionKey,
    runPrompt: buildBrowserosAcpPrompt(
      OPENCLAW_BROWSEROS_ACP_INSTRUCTIONS,
      input.message,
    ),
    commandEnv: {},
    commandIdentity: 'openclaw',
    useBrowserosMcp: false,
    openclawSessionKey: input.sessionKey,
  }
}

// ── Factory + wire-up ──────────────────────────────────────────────

export interface ConfigureOpenClawRuntimeOptions {
  resourcesDir?: string
  browserosDir?: string
  /** Required: the service-side port allocator. The runtime calls
   *  this every time it builds a container spec or probes readiness. */
  getHostPort: () => number
}

/** Build an OpenClawContainerRuntime with production deps and register it. */
export function configureOpenClawRuntime(
  options: ConfigureOpenClawRuntimeOptions,
): OpenClawContainerRuntime | null {
  if (process.platform !== 'darwin') {
    logger.warn('OpenClaw runtime skipped: unsupported platform', {
      platform: process.platform,
    })
    return null
  }

  const browserosDir = options.browserosDir ?? getBrowserosDir()
  const openclawDir = getOpenClawDir()
  const resourcesDir = options.resourcesDir ?? null
  const limactlPath = resourcesDir
    ? resolveBundledLimactl(resourcesDir)
    : 'limactl'
  const limaHome = getLimaHomeDir(browserosDir)

  const vm = new VmRuntime({
    limactlPath,
    limaHome,
    templatePath: resourcesDir
      ? resolveBundledLimaTemplate(resourcesDir)
      : undefined,
    browserosRoot: browserosDir,
  })
  const cli = new ContainerCli({ limactlPath, limaHome, vmName: VM_NAME })
  const loader = new ImageLoader(cli)

  const runtime = new OpenClawContainerRuntime(
    {
      cli,
      loader,
      vm,
      limactlPath,
      limaHome,
      vmName: VM_NAME,
      lockDir: join(openclawDir, '.locks'),
    },
    { browserosDir, openclawDir, getHostPort: options.getHostPort },
  )

  getAgentRuntimeRegistry().register(runtime)
  logger.debug('OpenClawContainerRuntime registered', {
    image: runtime.descriptor.defaultImage,
  })
  return runtime
}

export function getOpenClawRuntime(): OpenClawContainerRuntime | null {
  const r = getAgentRuntimeRegistry().get('openclaw')
  return r instanceof OpenClawContainerRuntime ? r : null
}
