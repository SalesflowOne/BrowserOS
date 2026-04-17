/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Main orchestrator for OpenClaw integration.
 * Container lifecycle via Podman, agent CRUD via in-container CLI,
 * chat via HTTP /v1/chat/completions proxy.
 */

import { existsSync } from 'node:fs'
import {
  copyFile,
  mkdir,
  readdir,
  readFile,
  rename,
  writeFile,
} from 'node:fs/promises'
import { join, resolve } from 'node:path'
import {
  OPENCLAW_CONTAINER_HOME,
  OPENCLAW_GATEWAY_PORT,
} from '@browseros/shared/constants/openclaw'
import { DEFAULT_PORTS } from '@browseros/shared/constants/ports'
import { getOpenClawDir } from '../../../lib/browseros-dir'
import { logger } from '../../../lib/logger'
import { ContainerRuntime } from './container-runtime'
import {
  OpenClawAgentAlreadyExistsError,
  OpenClawAgentNotFoundError,
  OpenClawInvalidAgentNameError,
  OpenClawProtectedAgentError,
} from './errors'
import {
  type OpenClawAgentRecord,
  OpenClawCliClient,
} from './openclaw-cli-client'
import {
  buildComposeEnvFile,
  getHostWorkspaceDir,
  getOpenClawStateConfigPath,
  getOpenClawStateDir,
  getOpenClawStateEnvPath,
  mergeEnvContent,
} from './openclaw-env'
import { OpenClawHttpChatClient } from './openclaw-http-chat-client'
import { resolveSupportedOpenClawProvider } from './openclaw-provider-map'
import type { OpenClawStreamEvent } from './openclaw-types'
import { getPodmanRuntime } from './podman-runtime'

const COMPOSE_RESOURCE = resolve(
  import.meta.dir,
  '../../../../resources/openclaw-compose.yml',
)
const READY_TIMEOUT_MS = 30_000
const AGENT_NAME_PATTERN = /^[a-z][a-z0-9-]*$/

export type OpenClawControlPlaneStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  // Retained for extension compatibility while the UI still branches on it.
  | 'recovering'
  | 'failed'

export type OpenClawGatewayRecoveryReason =
  // Retained for extension compatibility while the UI still renders these reasons.
  | 'transient_disconnect'
  | 'signature_expired'
  | 'pairing_required'
  | 'token_mismatch'
  | 'container_not_ready'
  | 'unknown'

export type OpenClawStatus =
  | 'uninitialized'
  | 'starting'
  | 'running'
  | 'stopped'
  | 'error'

export interface OpenClawStatusResponse {
  status: OpenClawStatus
  podmanAvailable: boolean
  machineReady: boolean
  port: number | null
  agentCount: number
  error: string | null
  controlPlaneStatus: OpenClawControlPlaneStatus
  lastGatewayError: string | null
  lastRecoveryReason: OpenClawGatewayRecoveryReason | null
}

export type OpenClawAgentEntry = OpenClawAgentRecord

export interface SetupInput {
  providerType?: string
  providerName?: string
  baseUrl?: string
  apiKey?: string
  modelId?: string
}

export interface OpenClawProviderUpdateResult {
  restarted: boolean
  modelUpdated: boolean
}

export class OpenClawService {
  private runtime: ContainerRuntime
  private cliClient: OpenClawCliClient
  private chatClient: OpenClawHttpChatClient
  private openclawDir: string
  private port = OPENCLAW_GATEWAY_PORT
  private token: string
  private lastError: string | null = null
  private browserosServerPort: number
  private controlPlaneStatus: OpenClawControlPlaneStatus = 'disconnected'
  private lastGatewayError: string | null = null
  private lastRecoveryReason: OpenClawGatewayRecoveryReason | null = null
  private stopLogTail: (() => void) | null = null

  constructor(browserosServerPort?: number) {
    this.openclawDir = getOpenClawDir()
    this.runtime = new ContainerRuntime(getPodmanRuntime(), this.openclawDir)
    this.token = crypto.randomUUID()
    this.cliClient = new OpenClawCliClient(this.runtime)
    this.chatClient = new OpenClawHttpChatClient(
      this.port,
      async () => this.token,
    )
    this.browserosServerPort = browserosServerPort ?? DEFAULT_PORTS.server
  }

  // ── Lifecycle ────────────────────────────────────────────────────────

  async setup(input: SetupInput, onLog?: (msg: string) => void): Promise<void> {
    const logProgress = this.createProgressLogger(onLog)
    const provider = resolveSupportedOpenClawProvider(input)
    logger.info('Starting OpenClaw setup', {
      port: this.port,
      browserosServerPort: this.browserosServerPort,
      providerType: input.providerType,
      providerName: input.providerName,
      hasBaseUrl: !!input.baseUrl,
      hasModel: !!input.modelId,
      hasApiKey: !!input.apiKey,
    })

    logProgress('Checking container runtime...')
    const available = await this.runtime.isPodmanAvailable()
    if (!available) {
      throw new Error(
        'Podman is not available. Install Podman to use OpenClaw agents.',
      )
    }

    await this.migrateLegacyStateIfNeeded()
    await this.runtime.ensureReady(logProgress)
    logProgress('Container runtime ready')

    await mkdir(this.openclawDir, { recursive: true })
    await mkdir(this.getStateDir(), { recursive: true })
    await mkdir(this.getHostWorkspaceDir('main'), { recursive: true })

    logProgress('Copying compose file...')
    await this.runtime.copyComposeFile(COMPOSE_RESOURCE)

    const envContent = buildComposeEnvFile({
      hostHome: this.openclawDir,
      port: this.port,
    })
    await this.runtime.writeEnvFile(envContent)
    logProgress('Generated .env file')
    logger.info('Wrote OpenClaw env file', {
      openclawDir: this.openclawDir,
    })

    await this.writeStateEnv(provider.envValues)
    logger.info('Updated OpenClaw state env', {
      providerKeyCount: Object.keys(provider.envValues).length,
    })

    logProgress('Pulling OpenClaw image...')
    await this.runtime.composePull(logProgress)
    logProgress('Image ready')

    logProgress('Starting OpenClaw gateway...')
    await this.runtime.composeUp(logProgress)
    this.startGatewayLogTail()

    logProgress('Waiting for gateway readiness...')
    const ready = await this.runtime.waitForReady(this.port, READY_TIMEOUT_MS)
    if (!ready) {
      this.lastError = 'Gateway did not become ready within 30 seconds'
      const logs = await this.runtime.composeLogs()
      logger.error('Gateway readiness check failed', { logs })
      throw new Error(this.lastError)
    }

    logProgress('Bootstrapping OpenClaw config...')
    await this.cliClient.runOnboard({
      acceptRisk: true,
      authChoice: 'skip',
      gatewayAuth: 'token',
      gatewayBind: 'lan',
      gatewayPort: this.port,
      mode: 'local',
      nonInteractive: true,
      skipHealth: true,
    })
    await this.applyBrowserosConfig()
    if (provider.model) {
      await this.cliClient.setDefaultModel(provider.model)
    }

    logProgress('Validating OpenClaw config...')
    await this.assertConfigValid()
    await this.loadTokenFromConfig()

    logProgress('Restarting OpenClaw gateway...')
    await this.runtime.composeRestart(logProgress)

    logProgress('Waiting for gateway readiness...')
    const restarted = await this.runtime.waitForReady(
      this.port,
      READY_TIMEOUT_MS,
    )
    if (!restarted) {
      this.lastError = 'Gateway did not become ready after bootstrap restart'
      throw new Error(this.lastError)
    }

    this.controlPlaneStatus = 'connecting'
    logProgress('Probing OpenClaw control plane...')
    await this.runControlPlaneCall(() => this.cliClient.probe())

    const existingAgents = await this.listAgents()
    logger.info('Fetched existing OpenClaw agents after setup', {
      count: existingAgents.length,
      names: existingAgents.map((agent) => agent.name),
    })
    if (existingAgents.some((agent) => agent.agentId === 'main')) {
      logProgress('Main agent detected')
    } else {
      logProgress('Creating main agent...')
      await this.runControlPlaneCall(() =>
        this.cliClient.createAgent({
          name: 'main',
          model: provider.model,
        }),
      )
    }

    this.lastError = null
    logProgress(`OpenClaw gateway running at http://127.0.0.1:${this.port}`)
    logger.info('OpenClaw setup complete', { port: this.port })
  }

  async start(onLog?: (msg: string) => void): Promise<void> {
    const logProgress = this.createProgressLogger(onLog)
    logger.info('Starting OpenClaw service', {
      port: this.port,
    })

    await this.migrateLegacyStateIfNeeded()
    await this.runtime.ensureReady(logProgress)
    logProgress('Starting OpenClaw gateway...')
    await this.runtime.composeUp(logProgress)
    this.startGatewayLogTail()

    logProgress('Waiting for gateway readiness...')
    const ready = await this.runtime.waitForReady(this.port, READY_TIMEOUT_MS)
    if (!ready) {
      this.lastError = 'Gateway did not become ready after start'
      throw new Error(this.lastError)
    }

    this.controlPlaneStatus = 'connecting'
    logProgress('Refreshing gateway auth token...')
    await this.loadTokenFromConfig()
    logProgress('Probing OpenClaw control plane...')
    await this.runControlPlaneCall(() => this.cliClient.probe())
    this.lastError = null
    logger.info('OpenClaw gateway started', { port: this.port })
  }

  async stop(): Promise<void> {
    logger.info('Stopping OpenClaw service', { port: this.port })
    this.controlPlaneStatus = 'disconnected'
    this.stopGatewayLogTail()
    await this.runtime.composeStop()
    logger.info('OpenClaw container stopped')
  }

  async restart(onLog?: (msg: string) => void): Promise<void> {
    const logProgress = this.createProgressLogger(onLog)
    logger.info('Restarting OpenClaw service', {
      port: this.port,
    })

    this.controlPlaneStatus = 'reconnecting'
    this.stopGatewayLogTail()
    logProgress('Restarting OpenClaw gateway...')
    await this.runtime.composeRestart(logProgress)
    this.startGatewayLogTail()

    logProgress('Waiting for gateway readiness...')
    const ready = await this.runtime.waitForReady(this.port, READY_TIMEOUT_MS)
    if (!ready) {
      this.lastError = 'Gateway did not become ready after restart'
      throw new Error(this.lastError)
    }

    logProgress('Refreshing gateway auth token...')
    await this.loadTokenFromConfig()
    logProgress('Probing OpenClaw control plane...')
    await this.runControlPlaneCall(() => this.cliClient.probe())
    this.lastError = null
    logProgress('Gateway restarted successfully')
    logger.info('OpenClaw gateway restarted', { port: this.port })
  }

  async reconnectControlPlane(onLog?: (msg: string) => void): Promise<void> {
    const logProgress = this.createProgressLogger(onLog)
    logger.info('Reconnecting OpenClaw control plane', { port: this.port })

    logProgress('Checking gateway readiness...')
    const ready = await this.runtime.isReady(this.port)
    if (!ready) {
      this.controlPlaneStatus = 'failed'
      this.lastGatewayError = 'OpenClaw gateway is not ready'
      this.lastRecoveryReason = 'container_not_ready'
      throw new Error('OpenClaw gateway is not ready')
    }

    logProgress('Reloading gateway auth token...')
    await this.loadTokenFromConfig()
    this.controlPlaneStatus = 'reconnecting'
    logProgress('Reconnecting control plane...')
    await this.runControlPlaneCall(() => this.cliClient.probe())
    logProgress('Control plane connected')
  }

  async shutdown(): Promise<void> {
    this.controlPlaneStatus = 'disconnected'
    this.stopGatewayLogTail()
    try {
      await this.runtime.composeStop()
    } catch {
      // Best effort during shutdown
    }
    await this.runtime.stopMachineIfSafe()
    logger.info('OpenClaw shutdown complete')
  }

  // ── Status ───────────────────────────────────────────────────────────

  async getStatus(): Promise<OpenClawStatusResponse> {
    const podmanAvailable = await this.runtime.isPodmanAvailable()
    if (!podmanAvailable) {
      return {
        status: 'uninitialized',
        podmanAvailable: false,
        machineReady: false,
        port: null,
        agentCount: 0,
        error: null,
        controlPlaneStatus: 'disconnected',
        lastGatewayError: null,
        lastRecoveryReason: null,
      }
    }

    await this.migrateLegacyStateIfNeeded()
    const isSetUp = existsSync(this.getStateConfigPath())
    if (!isSetUp) {
      const machineStatus = await this.runtime.getMachineStatus()
      return {
        status: 'uninitialized',
        podmanAvailable: true,
        machineReady: machineStatus.running,
        port: null,
        agentCount: 0,
        error: null,
        controlPlaneStatus: 'disconnected',
        lastGatewayError: this.lastGatewayError,
        lastRecoveryReason: this.lastRecoveryReason,
      }
    }

    const machineStatus = await this.runtime.getMachineStatus()
    const ready = machineStatus.running
      ? await this.runtime.isReady(this.port)
      : false

    let agentCount = 0
    if (ready) {
      try {
        const agents = await this.runControlPlaneCall(() =>
          this.cliClient.listAgents(),
        )
        agentCount = agents.length
      } catch {
        // latest control plane error is captured by runControlPlaneCall
      }
    }

    return {
      status: ready ? 'running' : this.lastError ? 'error' : 'stopped',
      podmanAvailable: true,
      machineReady: machineStatus.running,
      port: this.port,
      agentCount,
      error: this.lastError,
      controlPlaneStatus: ready ? this.controlPlaneStatus : 'disconnected',
      lastGatewayError: this.lastGatewayError,
      lastRecoveryReason: this.lastRecoveryReason,
    }
  }

  // ── Agent Management (via CLI) ──────────────────────────────────────

  async createAgent(input: {
    name: string
    providerType?: string
    providerName?: string
    baseUrl?: string
    apiKey?: string
    modelId?: string
  }): Promise<OpenClawAgentEntry> {
    const { name } = input
    if (!AGENT_NAME_PATTERN.test(name)) {
      throw new OpenClawInvalidAgentNameError()
    }

    logger.debug('Creating OpenClaw agent', {
      name,
      providerType: input.providerType,
      providerName: input.providerName,
      hasBaseUrl: !!input.baseUrl,
      hasModel: !!input.modelId,
      hasApiKey: !!input.apiKey,
    })
    await this.assertGatewayReady()

    const provider = resolveSupportedOpenClawProvider(input)
    const keysChanged = await this.writeStateEnv(provider.envValues)

    if (keysChanged) {
      logger.info('OpenClaw provider config changed while creating agent', {
        name,
        keysChanged,
      })
      await this.restart()
    }

    const model = provider.model
    let agent: OpenClawAgentRecord
    try {
      agent = await this.runControlPlaneCall(() =>
        this.cliClient.createAgent({
          name,
          model,
        }),
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (message.includes('already exists')) {
        throw new OpenClawAgentAlreadyExistsError(name)
      }
      throw error
    }

    logger.info('Agent created via CLI', {
      agentId: agent.agentId,
      providerType: input.providerType,
    })
    return agent
  }

  async removeAgent(agentId: string): Promise<void> {
    logger.info('Removing OpenClaw agent', { agentId })
    if (agentId === 'main') {
      throw new OpenClawProtectedAgentError('Cannot delete the main agent')
    }

    await this.assertGatewayReady()
    try {
      await this.runControlPlaneCall(() => this.cliClient.deleteAgent(agentId))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (message.includes('not found')) {
        throw new OpenClawAgentNotFoundError(agentId)
      }
      throw error
    }
    logger.info('Agent removed via CLI', { agentId })
  }

  async listAgents(): Promise<OpenClawAgentEntry[]> {
    await this.assertGatewayReady()
    logger.debug('Listing OpenClaw agents')
    return this.runControlPlaneCall(() => this.cliClient.listAgents())
  }

  // ── Chat Stream (HTTP) ───────────────────────────────────────────────

  async chatStream(
    agentId: string,
    sessionKey: string,
    message: string,
  ): Promise<ReadableStream<OpenClawStreamEvent>> {
    await this.assertGatewayReady()
    logger.info('Starting OpenClaw chat stream', {
      agentId,
      sessionKey,
      messageLength: message.length,
    })
    return this.runControlPlaneCall(() =>
      this.chatClient.streamChat({
        agentId,
        sessionKey,
        message,
      }),
    )
  }

  // ── Provider Keys ────────────────────────────────────────────────────

  async updateProviderKeys(input: {
    providerType: string
    providerName?: string
    baseUrl?: string
    apiKey: string
    modelId?: string
  }): Promise<OpenClawProviderUpdateResult> {
    const provider = resolveSupportedOpenClawProvider(input)
    const changed = await this.writeStateEnv(provider.envValues)
    if (provider.model) {
      await this.cliClient.setDefaultModel(provider.model)
    }
    if (changed) {
      await this.restart()
    }
    logger.info('Provider keys updated', {
      providerType: input.providerType,
      modelUpdated: !!provider.model,
      restarted: changed,
    })
    return {
      restarted: changed,
      modelUpdated: !!provider.model,
    }
  }

  // ── Logs ─────────────────────────────────────────────────────────────

  async getLogs(tail = 100): Promise<string[]> {
    logger.debug('Fetching OpenClaw container logs', { tail })
    return this.runtime.composeLogs(tail)
  }

  // ── Auto-start on BrowserOS boot ────────────────────────────────────

  async tryAutoStart(): Promise<void> {
    await this.migrateLegacyStateIfNeeded()
    const isSetUp = existsSync(this.getStateConfigPath())
    if (!isSetUp) return

    const available = await this.runtime.isPodmanAvailable()
    if (!available) return
    logger.info('Attempting OpenClaw auto-start', {
      port: this.port,
    })

    try {
      await this.runtime.ensureReady()

      if (!(await this.runtime.isReady(this.port))) {
        await this.runtime.composeUp()
        const ready = await this.runtime.waitForReady(
          this.port,
          READY_TIMEOUT_MS,
        )
        if (!ready) {
          logger.warn('OpenClaw gateway failed to become ready on auto-start')
          return
        }
      }

      await this.loadTokenFromConfig()
      await this.runControlPlaneCall(() => this.cliClient.probe())
      logger.info('OpenClaw gateway auto-started')
    } catch (err) {
      logger.warn('OpenClaw auto-start failed', {
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  // ── Internal ─────────────────────────────────────────────────────────

  private async assertGatewayReady(): Promise<void> {
    const portReady = await this.runtime.isReady(this.port)
    logger.debug('Checking OpenClaw gateway readiness before use', {
      port: this.port,
      portReady,
      controlPlaneStatus: this.controlPlaneStatus,
    })
    if (portReady) {
      return
    }

    this.controlPlaneStatus = 'failed'
    this.lastGatewayError = 'OpenClaw gateway is not ready'
    this.lastRecoveryReason = 'container_not_ready'
    throw new Error('OpenClaw gateway is not ready')
  }

  private async runControlPlaneCall<T>(fn: () => Promise<T>): Promise<T> {
    try {
      await this.ensureTokenLoaded()
      const result = await fn()
      this.controlPlaneStatus = 'connected'
      this.lastGatewayError = null
      this.lastRecoveryReason = null
      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const reason = this.classifyControlPlaneError(error)
      this.controlPlaneStatus = 'failed'
      this.lastGatewayError = message
      this.lastRecoveryReason = reason
      throw error
    }
  }

  private classifyControlPlaneError(
    error: unknown,
  ): OpenClawGatewayRecoveryReason {
    const message = error instanceof Error ? error.message : String(error)
    if (message.includes('Unauthorized')) return 'token_mismatch'
    if (message.includes('token')) return 'token_mismatch'
    if (message.includes('not ready')) return 'container_not_ready'
    return 'unknown'
  }

  private startGatewayLogTail(): void {
    if (process.env.NODE_ENV !== 'development') return
    if (this.stopLogTail) return
    try {
      this.stopLogTail = this.runtime.tailGatewayLogs((line) => {
        logger.debug(line)
      })
      logger.info('Streaming OpenClaw gateway logs into server log (dev mode)')
    } catch (err) {
      logger.warn('Failed to start OpenClaw gateway log tail', {
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  private stopGatewayLogTail(): void {
    if (!this.stopLogTail) return
    try {
      this.stopLogTail()
    } catch {
      // best effort
    }
    this.stopLogTail = null
  }

  private getHostWorkspaceDir(agentName: string): string {
    return getHostWorkspaceDir(this.openclawDir, agentName)
  }

  private getStateConfigPath(): string {
    return getOpenClawStateConfigPath(this.openclawDir)
  }

  private getStateDir(): string {
    return getOpenClawStateDir(this.openclawDir)
  }

  private getStateEnvPath(): string {
    return getOpenClawStateEnvPath(this.openclawDir)
  }

  private getLegacyStateConfigPath(): string {
    return join(this.openclawDir, 'openclaw.json')
  }

  private getLegacyRootEnvPath(): string {
    return join(this.openclawDir, '.env')
  }

  private async listLegacyStateDirs(): Promise<string[]> {
    try {
      const entries = await readdir(this.openclawDir, { withFileTypes: true })
      return entries
        .filter(
          (entry) =>
            entry.isDirectory() &&
            (entry.name === 'agents' ||
              entry.name === 'workspace' ||
              entry.name.startsWith('workspace-')),
        )
        .map((entry) => entry.name)
    } catch {
      return []
    }
  }

  private async migrateLegacyStateIfNeeded(): Promise<void> {
    await mkdir(this.openclawDir, { recursive: true })

    const legacyStateDirs = await this.listLegacyStateDirs()
    const hasLegacyState =
      existsSync(this.getLegacyStateConfigPath()) || legacyStateDirs.length > 0

    if (!hasLegacyState) {
      return
    }

    await mkdir(this.getStateDir(), { recursive: true })

    let migrated = false
    const legacyConfigPath = this.getLegacyStateConfigPath()
    const stateConfigPath = this.getStateConfigPath()
    if (existsSync(legacyConfigPath) && !existsSync(stateConfigPath)) {
      await rename(legacyConfigPath, stateConfigPath)
      migrated = true
    }

    const legacyEnvPath = this.getLegacyRootEnvPath()
    const stateEnvPath = this.getStateEnvPath()
    if (existsSync(legacyEnvPath) && !existsSync(stateEnvPath)) {
      await copyFile(legacyEnvPath, stateEnvPath)
      migrated = true
    }

    for (const dirName of legacyStateDirs) {
      const legacyDirPath = join(this.openclawDir, dirName)
      const stateDirPath = join(this.getStateDir(), dirName)
      if (existsSync(stateDirPath)) {
        continue
      }
      await rename(legacyDirPath, stateDirPath)
      migrated = true
    }

    if (migrated) {
      logger.info('Migrated legacy OpenClaw state layout', {
        openclawDir: this.openclawDir,
        migratedDirCount: legacyStateDirs.length,
      })
    }
  }

  private async applyBrowserosConfig(): Promise<void> {
    await this.cliClient.setConfig(
      'agents.defaults.workspace',
      `${OPENCLAW_CONTAINER_HOME}/workspace`,
    )
    await this.cliClient.setConfig('agents.defaults.timeoutSeconds', 4200)
    await this.cliClient.setConfig(
      'agents.defaults.thinkingDefault',
      'adaptive',
    )
    await this.cliClient.setConfig('gateway.reload.mode', 'restart')
    await this.cliClient.setConfig('gateway.controlUi.allowInsecureAuth', true)
    await this.cliClient.setConfig('gateway.controlUi.allowedOrigins', [
      `http://127.0.0.1:${this.port}`,
      `http://localhost:${this.port}`,
    ])
    await this.cliClient.setConfig(
      'gateway.http.endpoints.chatCompletions.enabled',
      true,
    )
    await this.cliClient.setConfig('tools.profile', 'full')
    await this.cliClient.setConfig('tools.web.search.provider', 'duckduckgo')
    await this.cliClient.setConfig('tools.web.search.enabled', true)
    await this.cliClient.setConfig('tools.exec.host', 'gateway')
    await this.cliClient.setConfig('tools.exec.security', 'full')
    await this.cliClient.setConfig('tools.exec.ask', 'off')
    await this.cliClient.setConfig('cron.enabled', true)
    await this.cliClient.setConfig('hooks.internal.enabled', true)
    await this.cliClient.setConfig(
      'hooks.internal.entries.boot-md.enabled',
      true,
    )
    await this.cliClient.setConfig(
      'hooks.internal.entries.bootstrap-extra-files.enabled',
      true,
    )
    await this.cliClient.setConfig(
      'hooks.internal.entries.session-memory.enabled',
      true,
    )
    await this.cliClient.setConfig(
      'mcp.servers.browseros.url',
      `http://host.containers.internal:${this.browserosServerPort}/mcp`,
    )
    await this.cliClient.setConfig(
      'mcp.servers.browseros.transport',
      'streamable-http',
    )
    await this.cliClient.setConfig('approvals.exec.enabled', false)
    await this.cliClient.setConfig('skills.install.nodeManager', 'bun')

    if (process.env.NODE_ENV === 'development') {
      await this.cliClient.setConfig('logging.level', 'debug')
      await this.cliClient.setConfig('logging.consoleLevel', 'debug')
    }
  }

  private async assertConfigValid(): Promise<void> {
    const validation = await this.cliClient.validateConfig()
    if (
      validation &&
      typeof validation === 'object' &&
      'ok' in validation &&
      validation.ok === false
    ) {
      throw new Error('OpenClaw config validation failed')
    }
  }

  private async writeStateEnv(
    values: Record<string, string>,
  ): Promise<boolean> {
    if (Object.keys(values).length === 0) return false

    const envPath = this.getStateEnvPath()
    let content = ''
    try {
      content = await readFile(envPath, 'utf-8')
    } catch {
      // state env may not exist yet
    }

    const next = mergeEnvContent(content, values)
    if (!next.changed) return false

    await mkdir(this.getStateDir(), { recursive: true })
    await writeFile(envPath, next.content, { mode: 0o600 })
    logger.debug('Updated OpenClaw provider credentials', {
      keys: Object.keys(values),
    })
    return true
  }

  private async ensureTokenLoaded(): Promise<void> {
    await this.migrateLegacyStateIfNeeded()
    if (!existsSync(this.getStateConfigPath())) {
      return
    }

    await this.loadTokenFromConfig()
  }

  private async loadTokenFromConfig(): Promise<void> {
    try {
      const token = await this.cliClient.getConfig('gateway.auth.token')
      if (typeof token === 'string' && token) {
        this.token = token
        logger.info('Loaded OpenClaw gateway token from CLI config')
      }
    } catch (err) {
      logger.warn('Failed to load OpenClaw gateway token from CLI config', {
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  private createProgressLogger(
    onLog?: (msg: string) => void,
  ): (msg: string) => void {
    return (msg) => {
      logger.debug(`OpenClaw: ${msg}`)
      onLog?.(msg)
    }
  }
}

let service: OpenClawService | null = null

export function getOpenClawService(
  browserosServerPort?: number,
): OpenClawService {
  if (!service) service = new OpenClawService(browserosServerPort)
  return service
}
