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
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import {
  OPENCLAW_CONTAINER_HOME,
  OPENCLAW_GATEWAY_PORT,
} from '@browseros/shared/constants/openclaw'
import { DEFAULT_PORTS } from '@browseros/shared/constants/ports'
import { getOpenClawDir } from '../../../lib/browseros-dir'
import { logger } from '../../../lib/logger'
import type { MonitoringChatTurn } from '../../../monitoring/types'
import {
  ContainerRuntime,
  type GatewayContainerSpec,
  type GatewayInspection,
} from './container-runtime'
import {
  OpenClawAgentAlreadyExistsError,
  OpenClawAgentNotFoundError,
  OpenClawInvalidAgentNameError,
  OpenClawProtectedAgentError,
} from './errors'
import {
  type OpenClawAgentRecord,
  OpenClawCliClient,
  type OpenClawConfigBatchEntry,
} from './openclaw-cli-client'
import {
  getHostWorkspaceDir,
  getOpenClawStateConfigPath,
  getOpenClawStateDir,
  getOpenClawStateEnvPath,
  mergeEnvContent,
} from './openclaw-env'
import { OpenClawHttpChatClient } from './openclaw-http-chat-client'
import {
  type ResolvedOpenClawProviderConfig,
  resolveSupportedOpenClawProvider,
} from './openclaw-provider-map'
import {
  loadOpenClawRuntimeState,
  type OpenClawRuntimeState,
  saveOpenClawRuntimeState,
} from './openclaw-runtime-state'
import type { OpenClawStreamEvent } from './openclaw-types'
import { loadPodmanOverrides, savePodmanOverrides } from './podman-overrides'
import { configurePodmanRuntime, getPodmanRuntime } from './podman-runtime'

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

export interface OpenClawServiceConfig {
  browserosServerPort?: number
  resourcesDir?: string
}

export interface OpenClawPodmanOverridesResponse {
  podmanPath: string | null
  effectivePodmanPath: string
}

export class OpenClawService {
  private runtime: ContainerRuntime
  private cliClient: OpenClawCliClient
  private bootstrapCliClient: OpenClawCliClient
  private chatClient: OpenClawHttpChatClient
  private openclawDir: string
  private port = OPENCLAW_GATEWAY_PORT
  private token: string
  private tokenLoaded = false
  private lastError: string | null = null
  private browserosServerPort: number
  private resourcesDir: string | null
  private controlPlaneStatus: OpenClawControlPlaneStatus = 'disconnected'
  private lastGatewayError: string | null = null
  private lastRecoveryReason: OpenClawGatewayRecoveryReason | null = null
  private stopLogTail: (() => void) | null = null
  private runtimeState: OpenClawRuntimeState | null = null
  private runtimeStateLoaded = false

  constructor(config: OpenClawServiceConfig = {}) {
    this.openclawDir = getOpenClawDir()
    this.runtime = new ContainerRuntime(getPodmanRuntime(), this.openclawDir)
    this.token = crypto.randomUUID()
    this.cliClient = new OpenClawCliClient(this.runtime)
    this.bootstrapCliClient = this.buildBootstrapCliClient()
    this.chatClient = new OpenClawHttpChatClient(
      this.port,
      async () => this.token,
    )
    this.browserosServerPort =
      config.browserosServerPort ?? DEFAULT_PORTS.server
    this.resourcesDir = config.resourcesDir ?? null
  }

  configure(config: OpenClawServiceConfig): void {
    if (config.browserosServerPort !== undefined) {
      this.browserosServerPort = config.browserosServerPort
    }
    if (config.resourcesDir !== undefined) {
      this.resourcesDir = config.resourcesDir
    }
  }

  // ── Lifecycle ────────────────────────────────────────────────────────

  async setup(input: SetupInput, onLog?: (msg: string) => void): Promise<void> {
    const logProgress = this.createProgressLogger(onLog)
    const provider = resolveSupportedOpenClawProvider(input)
    await this.loadRuntimeState()
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

    await this.runtime.ensureReady(logProgress)
    logProgress('Container runtime ready')

    await mkdir(this.openclawDir, { recursive: true })
    await mkdir(this.getStateDir(), { recursive: true })
    await mkdir(this.getHostWorkspaceDir('main'), { recursive: true })

    await this.ensureStateEnvFile()
    await this.writeStateEnv(provider.envValues)
    logger.info('Updated OpenClaw state env', {
      providerKeyCount: Object.keys(provider.envValues).length,
    })

    logProgress('Pulling OpenClaw image...')
    await this.runtime.pullImage(this.getGatewayImage(), logProgress)
    logProgress('Image ready')

    logProgress('Bootstrapping OpenClaw config...')
    await this.bootstrapCliClient.runOnboard({
      acceptRisk: true,
      authChoice: 'skip',
      gatewayAuth: 'token',
      gatewayBind: 'lan',
      gatewayPort: this.port,
      installDaemon: false,
      mode: 'local',
      nonInteractive: true,
      skipHealth: true,
    })
    await this.applyBrowserosConfig()
    await this.mergeProviderConfigIfChanged(provider)
    if (provider.model) {
      await this.bootstrapCliClient.setDefaultModel(provider.model)
    }

    logProgress('Validating OpenClaw config...')
    await this.assertConfigValid(this.bootstrapCliClient)

    this.tokenLoaded = false
    await this.loadTokenFromConfig()

    logProgress('Starting OpenClaw gateway...')
    this.controlPlaneStatus = 'connecting'
    await this.launchGatewayRuntime({
      logProgress,
      readyFailureMessage: 'Gateway did not become ready within 30 seconds',
      start: () =>
        this.runtime.startGateway(this.buildGatewayRuntimeSpec(), logProgress),
    })

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
    await this.loadRuntimeState()
    logger.info('Starting OpenClaw service', {
      port: this.port,
    })

    await this.runtime.ensureReady(logProgress)

    logProgress('Refreshing gateway auth token...')
    this.tokenLoaded = false
    await this.loadTokenFromConfig()
    await this.ensureStateEnvFile()

    logProgress('Starting OpenClaw gateway...')
    this.controlPlaneStatus = 'connecting'
    await this.launchGatewayRuntime({
      logProgress,
      readyFailureMessage: 'Gateway did not become ready after start',
      start: () =>
        this.runtime.startGateway(this.buildGatewayRuntimeSpec(), logProgress),
    })
    this.lastError = null
    logger.info('OpenClaw gateway started', { port: this.port })
  }

  async stop(): Promise<void> {
    logger.info('Stopping OpenClaw service', { port: this.port })
    this.controlPlaneStatus = 'disconnected'
    this.stopGatewayLogTail()
    await this.runtime.stopGateway()
    logger.info('OpenClaw container stopped')
  }

  async restart(onLog?: (msg: string) => void): Promise<void> {
    const logProgress = this.createProgressLogger(onLog)
    await this.loadRuntimeState()
    logger.info('Restarting OpenClaw service', {
      port: this.port,
    })

    this.controlPlaneStatus = 'reconnecting'
    this.stopGatewayLogTail()
    logProgress('Refreshing gateway auth token...')
    this.tokenLoaded = false
    await this.loadTokenFromConfig()
    await this.ensureStateEnvFile()
    logProgress('Restarting OpenClaw gateway...')
    try {
      await this.launchGatewayRuntime({
        logProgress,
        readyFailureMessage: 'Gateway did not become ready after restart',
        start: () =>
          this.runtime.restartGateway(
            this.buildGatewayRuntimeSpec(),
            logProgress,
          ),
      })
      this.lastError = null
      logProgress('Gateway restarted successfully')
      logger.info('OpenClaw gateway restarted', { port: this.port })
    } catch (error) {
      if (this.isStrongMachineCorruptionSignature(error)) {
        logger.warn(
          'OpenClaw restart hit machine corruption; repairing runtime',
          {
            error: error instanceof Error ? error.message : String(error),
          },
        )
        await this.repairRuntime(onLog)
        return
      }
      this.controlPlaneStatus = 'failed'
      this.lastGatewayError =
        error instanceof Error ? error.message : String(error)
      this.lastRecoveryReason = this.classifyControlPlaneError(error)
      throw error
    }
  }

  async reconnectControlPlane(onLog?: (msg: string) => void): Promise<void> {
    const logProgress = this.createProgressLogger(onLog)
    await this.loadRuntimeState()
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
    this.tokenLoaded = false
    await this.loadTokenFromConfig()
    this.controlPlaneStatus = 'reconnecting'
    logProgress('Reconnecting control plane...')
    await this.runControlPlaneCall(() => this.cliClient.probe())
    this.lastError = null
    logProgress('Control plane connected')
  }

  async shutdown(): Promise<void> {
    this.controlPlaneStatus = 'disconnected'
    this.stopGatewayLogTail()
    try {
      await this.runtime.stopGateway()
    } catch {
      // Best effort during shutdown
    }
    await this.runtime.stopMachineIfSafe()
    logger.info('OpenClaw shutdown complete')
  }

  async repairRuntime(onLog?: (msg: string) => void): Promise<void> {
    const logProgress = this.createProgressLogger(onLog)
    await this.loadRuntimeState()
    const nextRepairGeneration = (this.runtimeState?.repairGeneration ?? 0) + 1

    this.controlPlaneStatus = 'recovering'
    this.stopGatewayLogTail()

    logProgress('Stopping OpenClaw gateway...')
    try {
      await this.runtime.stopGateway(logProgress)
    } catch {
      // Best effort before a repair start.
    }

    logProgress('Checking Podman machine...')
    try {
      await this.runtime.stopMachineIfSafe()
    } catch {
      // Best effort before a repair start.
    }

    logProgress('Ensuring Podman runtime is ready...')
    await this.runtime.ensureReady(logProgress)

    logProgress('Refreshing gateway auth token...')
    this.tokenLoaded = false
    await this.loadTokenFromConfig()
    await this.ensureStateEnvFile()

    logProgress('Starting repaired OpenClaw gateway...')
    try {
      this.controlPlaneStatus = 'connecting'
      await this.launchGatewayRuntime({
        logProgress,
        readyFailureMessage: 'Gateway did not become ready after repair',
        start: () =>
          this.runtime.startGateway(
            this.buildGatewayRuntimeSpec(),
            logProgress,
          ),
      })
      await this.saveRuntimeState({
        ...(this.runtimeState ?? this.defaultRuntimeState()),
        repairGeneration: nextRepairGeneration,
        lastRepairOutcome: 'success',
      })
      this.lastError = null
      logger.info('OpenClaw runtime repaired', { port: this.port })
    } catch (error) {
      await this.saveRuntimeState({
        ...(this.runtimeState ?? this.defaultRuntimeState()),
        repairGeneration: nextRepairGeneration,
        lastRepairOutcome: 'failed',
      })
      this.controlPlaneStatus = 'failed'
      this.lastError =
        error instanceof Error ? error.message : 'Gateway repair failed'
      this.lastGatewayError = this.lastError
      this.lastRecoveryReason = this.classifyControlPlaneError(error)
      throw error
    }
  }

  async resetRuntime(): Promise<void> {
    this.stopGatewayLogTail()
    this.controlPlaneStatus = 'disconnected'
    this.tokenLoaded = false
    this.lastGatewayError = null
    this.lastRecoveryReason = null
    this.lastError = null

    try {
      await this.runtime.stopGateway()
    } catch {
      // Best effort reset.
    }

    try {
      await this.runtime.stopMachineIfSafe()
    } catch {
      // Best effort reset.
    }

    this.applyGatewayPort(OPENCLAW_GATEWAY_PORT)
    await this.saveRuntimeState(this.defaultRuntimeState())
    logger.info('OpenClaw runtime reset', { port: this.port })
  }

  // ── Status ───────────────────────────────────────────────────────────

  async getStatus(): Promise<OpenClawStatusResponse> {
    const podmanAvailable = await this.runtime.isPodmanAvailable()
    if (!podmanAvailable) {
      await this.loadRuntimeState()
      return {
        status: 'uninitialized',
        podmanAvailable: false,
        machineReady: false,
        port: this.runtimeState?.hostGatewayPort ?? null,
        agentCount: 0,
        error: null,
        controlPlaneStatus: 'disconnected',
        lastGatewayError: null,
        lastRecoveryReason: null,
      }
    }

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

    await this.loadRuntimeState()
    const inspection = await this.inspectGateway()
    const runtimePort =
      inspection?.hostPort ?? this.runtimeState?.hostGatewayPort
    if (runtimePort && runtimePort !== this.port) {
      await this.updateGatewayPort(runtimePort)
    }

    const machineStatus = await this.runtime.getMachineStatus()
    const ready =
      runtimePort && machineStatus.running
        ? await this.runtime.isReady(runtimePort)
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
      status: this.resolveStatus(machineStatus.running, ready),
      podmanAvailable: true,
      machineReady: machineStatus.running,
      port: runtimePort ?? null,
      agentCount,
      error: this.lastError,
      controlPlaneStatus: this.resolveControlPlaneStatus(ready),
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
    const configChanged = await this.mergeProviderConfigIfChanged(provider)
    const keysChanged = await this.writeStateEnv(provider.envValues)

    if (configChanged || keysChanged) {
      logger.info('OpenClaw provider config changed while creating agent', {
        name,
        configChanged,
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
    history: MonitoringChatTurn[] = [],
  ): Promise<ReadableStream<OpenClawStreamEvent>> {
    await this.assertGatewayReady()
    logger.info('Starting OpenClaw chat stream', {
      agentId,
      sessionKey,
      messageLength: message.length,
      historyLength: history.length,
    })
    return this.runControlPlaneCall(() =>
      this.chatClient.streamChat({
        agentId,
        sessionKey,
        message,
        history,
      }),
    )
  }

  // ── Podman Overrides ─────────────────────────────────────────────────

  async applyPodmanOverrides(input: {
    podmanPath: string | null
  }): Promise<OpenClawPodmanOverridesResponse> {
    await savePodmanOverrides(this.openclawDir, {
      podmanPath: input.podmanPath,
    })

    // Intentionally mutates the module-level PodmanRuntime singleton so every
    // consumer (including future service instances) sees the new path.
    configurePodmanRuntime({
      resourcesDir: this.resourcesDir ?? undefined,
      podmanPath: input.podmanPath ?? undefined,
    })

    this.rebuildRuntimeClients()
    const effectivePodmanPath = getPodmanRuntime().getPodmanPath()

    logger.info('Applied Podman overrides', {
      podmanPath: input.podmanPath,
      effectivePodmanPath,
    })

    return {
      podmanPath: input.podmanPath,
      effectivePodmanPath,
    }
  }

  async getPodmanOverrides(): Promise<OpenClawPodmanOverridesResponse> {
    const { podmanPath } = await loadPodmanOverrides(this.openclawDir)
    return {
      podmanPath,
      effectivePodmanPath: getPodmanRuntime().getPodmanPath(),
    }
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
    const configChanged = await this.mergeProviderConfigIfChanged(provider)
    const envChanged = await this.writeStateEnv(provider.envValues)
    const restarted = configChanged || envChanged
    if (restarted) {
      await this.restart()
    }
    if (provider.model) {
      const model = provider.model
      await this.applyCliMutation(() => this.cliClient.setDefaultModel(model))
    }
    logger.info('Provider keys updated', {
      providerType: input.providerType,
      modelUpdated: !!provider.model,
      restarted,
    })
    return {
      restarted,
      modelUpdated: !!provider.model,
    }
  }

  // ── Logs ─────────────────────────────────────────────────────────────

  async getLogs(tail = 100): Promise<string[]> {
    logger.debug('Fetching OpenClaw container logs', { tail })
    return this.runtime.getGatewayLogs(tail)
  }

  // ── Auto-start on BrowserOS boot ────────────────────────────────────

  async tryAutoStart(): Promise<void> {
    await this.loadRuntimeState()
    const isSetUp = existsSync(this.getStateConfigPath())
    if (!isSetUp) return

    const available = await this.runtime.isPodmanAvailable()
    if (!available) return
    logger.info('Attempting OpenClaw auto-start', {
      port: this.port,
    })

    try {
      await this.runtime.ensureReady()

      this.tokenLoaded = false
      await this.loadTokenFromConfig()
      await this.ensureStateEnvFile()

      if (!(await this.runtime.isReady(this.port))) {
        await this.launchGatewayRuntime({
          logProgress: (msg) => logger.debug(`OpenClaw: ${msg}`),
          readyFailureMessage: 'Gateway did not become ready on auto-start',
          start: () =>
            this.runtime.startGateway(this.buildGatewayRuntimeSpec()),
        })
      }

      await this.runControlPlaneCall(() => this.cliClient.probe())
      this.lastError = null
      logger.info('OpenClaw gateway auto-started')
    } catch (err) {
      logger.warn('OpenClaw auto-start failed', {
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  // ── Internal ─────────────────────────────────────────────────────────

  private buildBootstrapCliClient(): OpenClawCliClient {
    return new OpenClawCliClient({
      execInContainer: (command, onLog) =>
        this.runtime.runGatewaySetupCommand(
          command,
          this.buildGatewayRuntimeSpec(),
          onLog,
        ),
    })
  }

  private rebuildRuntimeClients(): void {
    this.stopGatewayLogTail()
    this.runtime = new ContainerRuntime(getPodmanRuntime(), this.openclawDir)
    this.cliClient = new OpenClawCliClient(this.runtime)
    this.bootstrapCliClient = this.buildBootstrapCliClient()
  }

  private async assertGatewayReady(): Promise<void> {
    await this.loadRuntimeState()
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

  private async applyBrowserosConfig(): Promise<void> {
    await this.bootstrapCliClient.setConfigBatch(this.getBrowserosConfigBatch())
  }

  private getBrowserosConfigBatch(): OpenClawConfigBatchEntry[] {
    const entries: OpenClawConfigBatchEntry[] = [
      {
        path: 'agents.defaults.workspace',
        value: `${OPENCLAW_CONTAINER_HOME}/workspace`,
      },
      {
        path: 'agents.defaults.thinkingDefault',
        value: 'off',
      },
      {
        path: 'gateway.controlUi.allowInsecureAuth',
        value: true,
      },
      {
        path: 'gateway.controlUi.allowedOrigins',
        value: [
          `http://127.0.0.1:${this.port}`,
          `http://localhost:${this.port}`,
        ],
      },
      {
        path: 'gateway.http.endpoints.chatCompletions.enabled',
        value: true,
      },
      {
        path: 'tools.profile',
        value: 'full',
      },
      {
        path: 'tools.web.search.provider',
        value: 'duckduckgo',
      },
      {
        path: 'tools.web.search.enabled',
        value: true,
      },
      {
        path: 'tools.exec.host',
        value: 'gateway',
      },
      {
        path: 'tools.exec.security',
        value: 'full',
      },
      {
        path: 'tools.exec.ask',
        value: 'off',
      },
      {
        path: 'cron.enabled',
        value: true,
      },
      {
        path: 'hooks.internal.enabled',
        value: true,
      },
      {
        path: 'mcp.servers.browseros.url',
        value: `http://host.containers.internal:${this.browserosServerPort}/mcp`,
      },
      {
        path: 'mcp.servers.browseros.transport',
        value: 'streamable-http',
      },
      {
        path: 'approvals.exec.enabled',
        value: false,
      },
      {
        path: 'skills.install.nodeManager',
        value: 'npm',
      },
      {
        path: 'agents.defaults.memorySearch.enabled',
        value: false,
      },
    ]

    if (process.env.NODE_ENV === 'development') {
      entries.push(
        {
          path: 'logging.level',
          value: 'debug',
        },
        {
          path: 'logging.consoleLevel',
          value: 'debug',
        },
      )
    }

    return entries
  }

  private defaultRuntimeState(): OpenClawRuntimeState {
    return {
      hostGatewayPort: null,
      lastSuccessfulStartAt: null,
      repairGeneration: 0,
      lastRepairOutcome: null,
    }
  }

  private async loadRuntimeState(): Promise<OpenClawRuntimeState> {
    if (!this.runtimeStateLoaded) {
      this.runtimeState =
        (await loadOpenClawRuntimeState(this.openclawDir)) ??
        this.defaultRuntimeState()
      this.runtimeStateLoaded = true
      if (this.runtimeState.hostGatewayPort !== null) {
        this.applyGatewayPort(this.runtimeState.hostGatewayPort)
      }
    }

    return this.runtimeState ?? this.defaultRuntimeState()
  }

  private async saveRuntimeState(
    state: OpenClawRuntimeState,
  ): Promise<OpenClawRuntimeState> {
    this.runtimeState = state
    this.runtimeStateLoaded = true
    await saveOpenClawRuntimeState(this.openclawDir, state)
    return state
  }

  private applyGatewayPort(port: number): void {
    if (this.port === port) return
    this.port = port
    this.chatClient = new OpenClawHttpChatClient(
      this.port,
      async () => this.token,
    )
  }

  private async updateGatewayPort(port: number): Promise<void> {
    const current = await this.loadRuntimeState()
    this.applyGatewayPort(port)
    await this.saveRuntimeState({
      ...current,
      hostGatewayPort: port,
    })
  }

  private async recordSuccessfulGatewayStart(port: number): Promise<void> {
    const current = await this.loadRuntimeState()
    this.applyGatewayPort(port)
    await this.saveRuntimeState({
      ...current,
      hostGatewayPort: port,
      lastSuccessfulStartAt: new Date().toISOString(),
      lastRepairOutcome: null,
    })
  }

  private async inspectGateway(): Promise<GatewayInspection | null> {
    const runtime = this.runtime as Partial<ContainerRuntime> & {
      inspectGateway?: () => Promise<GatewayInspection>
    }
    if (typeof runtime.inspectGateway !== 'function') {
      return null
    }

    try {
      return await runtime.inspectGateway()
    } catch (error) {
      logger.debug('OpenClaw gateway inspection failed', {
        error: error instanceof Error ? error.message : String(error),
      })
      return null
    }
  }

  private async launchGatewayRuntime(input: {
    logProgress: (msg: string) => void
    readyFailureMessage: string
    start: () => Promise<number>
  }): Promise<number> {
    const previousPort = this.port
    let hostPort: number | null = null

    try {
      hostPort = await input.start()
      this.applyGatewayPort(hostPort)
      this.startGatewayLogTail()

      input.logProgress('Waiting for gateway readiness...')
      const ready = await this.runtime.waitForReady(this.port, READY_TIMEOUT_MS)
      if (!ready) {
        this.lastError = input.readyFailureMessage
        throw new Error(this.lastError)
      }

      input.logProgress('Probing OpenClaw control plane...')
      await this.runControlPlaneCall(() => this.cliClient.probe())
      await this.recordSuccessfulGatewayStart(hostPort)
      return hostPort
    } catch (error) {
      this.stopGatewayLogTail()
      if (hostPort !== null) {
        this.applyGatewayPort(previousPort)
      }
      throw error
    }
  }

  private resolveStatus(
    machineRunning: boolean,
    ready: boolean,
  ): OpenClawStatus {
    if (this.hasFailureState()) {
      return 'error'
    }

    if (!machineRunning) {
      return 'stopped'
    }

    if (ready) {
      return 'running'
    }

    if (
      this.controlPlaneStatus === 'connecting' ||
      this.controlPlaneStatus === 'reconnecting' ||
      this.controlPlaneStatus === 'recovering'
    ) {
      return 'starting'
    }

    return 'stopped'
  }

  private resolveControlPlaneStatus(
    ready: boolean,
  ): OpenClawControlPlaneStatus {
    if (ready) {
      return this.controlPlaneStatus
    }

    if (
      this.controlPlaneStatus === 'connecting' ||
      this.controlPlaneStatus === 'reconnecting' ||
      this.controlPlaneStatus === 'recovering'
    ) {
      return this.controlPlaneStatus
    }

    return this.lastGatewayError || this.lastError ? 'failed' : 'disconnected'
  }

  private hasFailureState(): boolean {
    return (
      this.controlPlaneStatus === 'failed' ||
      this.controlPlaneStatus === 'recovering' ||
      this.lastGatewayError !== null ||
      this.lastError !== null ||
      this.lastRecoveryReason !== null
    )
  }

  private isStrongMachineCorruptionSignature(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error)
    const text = message.toLowerCase()
    return (
      text.includes('machine is corrupted') ||
      text.includes('needs to be removed') ||
      text.includes('podman machine start failed') ||
      text.includes('failed to start podman machine') ||
      text.includes('could not start podman machine') ||
      (text.includes('podman machine') && text.includes('corrupt'))
    )
  }

  private async applyCliMutation(action: () => Promise<void>): Promise<void> {
    let retried = false

    while (true) {
      try {
        await action()
        await this.waitForGatewayAfterCliMutation()
        return
      } catch (error) {
        if (!this.isRestartInterruptedCliMutation(error) || retried) {
          throw error
        }

        logger.info(
          'Retrying OpenClaw CLI mutation after gateway reload interrupted the command',
          {
            error: error instanceof Error ? error.message : String(error),
          },
        )
        await this.waitForGatewayAfterCliMutation()
        retried = true
      }
    }
  }

  private isRestartInterruptedCliMutation(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error)
    return (
      message.includes('Config overwrite:') && message.includes('openclaw.json')
    )
  }

  private async waitForGatewayAfterCliMutation(): Promise<void> {
    const ready = await this.runtime.waitForReady(this.port, READY_TIMEOUT_MS)
    if (!ready) {
      this.lastError = 'Gateway did not become ready after applying config'
      throw new Error(this.lastError)
    }
  }

  private async assertConfigValid(
    client: OpenClawCliClient = this.cliClient,
  ): Promise<void> {
    const validation = await client.validateConfig()
    if (
      validation &&
      typeof validation === 'object' &&
      'ok' in validation &&
      validation.ok === false
    ) {
      throw new Error('OpenClaw config validation failed')
    }
  }

  private async ensureStateEnvFile(): Promise<void> {
    const envPath = this.getStateEnvPath()
    if (existsSync(envPath)) return
    await mkdir(this.getStateDir(), { recursive: true })
    await writeFile(envPath, '', { mode: 0o600 })
  }

  // Pin away from latest because newer OpenClaw releases regress OpenRouter chat streams.
  private getGatewayImage(): string {
    return process.env.OPENCLAW_IMAGE || 'ghcr.io/openclaw/openclaw:2026.4.12'
  }

  private buildGatewayRuntimeSpec(): GatewayContainerSpec {
    return {
      image: this.getGatewayImage(),
      port: this.port,
      hostHome: this.openclawDir,
      envFilePath: this.getStateEnvPath(),
      gatewayToken: this.tokenLoaded ? this.token : undefined,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
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

  private async mergeProviderConfigIfChanged(
    provider: ResolvedOpenClawProviderConfig,
  ): Promise<boolean> {
    if (!provider.customProvider) {
      return false
    }

    const configPath = this.getStateConfigPath()
    const content = await readFile(configPath, 'utf-8')
    const config = JSON.parse(content) as Record<string, unknown>
    const models =
      config.models && typeof config.models === 'object'
        ? (config.models as Record<string, unknown>)
        : {}
    const providers =
      models.providers && typeof models.providers === 'object'
        ? (models.providers as Record<string, Record<string, unknown>>)
        : {}
    const existingProvider = providers[provider.customProvider.providerId] ?? {}
    const existingModels = Array.isArray(existingProvider.models)
      ? (existingProvider.models as Array<Record<string, unknown>>)
      : []
    const desiredModelEntry =
      Array.isArray(provider.customProvider.config.models) &&
      provider.customProvider.config.models.length > 0
        ? (provider.customProvider.config.models[0] as Record<string, unknown>)
        : null
    const hasDesiredModel = desiredModelEntry
      ? existingModels.some(
          (model) =>
            model.id === desiredModelEntry.id ||
            model.name === desiredModelEntry.name,
        )
      : true
    const mergedModels =
      desiredModelEntry && !hasDesiredModel
        ? [...existingModels, desiredModelEntry]
        : existingModels.length > 0
          ? existingModels
          : Array.isArray(provider.customProvider.config.models)
            ? provider.customProvider.config.models
            : undefined

    const nextProvider: Record<string, unknown> = {
      ...existingProvider,
      ...provider.customProvider.config,
      ...(mergedModels ? { models: mergedModels } : {}),
    }
    const nextModels: Record<string, unknown> = {
      ...models,
      mode: 'merge',
      providers: {
        ...providers,
        [provider.customProvider.providerId]: nextProvider,
      },
    }
    const nextConfig: Record<string, unknown> = {
      ...config,
      models: nextModels,
    }

    if (JSON.stringify(config) === JSON.stringify(nextConfig)) {
      return false
    }

    await writeFile(
      configPath,
      `${JSON.stringify(nextConfig, null, 2)}\n`,
      'utf-8',
    )
    logger.debug('Updated OpenClaw custom provider config', {
      providerId: provider.customProvider.providerId,
    })
    return true
  }

  private async ensureTokenLoaded(): Promise<void> {
    if (this.tokenLoaded) {
      return
    }
    if (!existsSync(this.getStateConfigPath())) {
      return
    }

    await this.loadTokenFromConfig()
  }

  private async loadTokenFromConfig(): Promise<void> {
    try {
      const config = JSON.parse(
        await readFile(this.getStateConfigPath(), 'utf-8'),
      ) as {
        gateway?: {
          auth?: {
            token?: unknown
          }
        }
      }
      const token = config.gateway?.auth?.token
      if (typeof token === 'string' && token) {
        this.token = token
        this.tokenLoaded = true
        logger.info('Loaded OpenClaw gateway token from mounted config')
      }
    } catch (err) {
      logger.warn('Failed to load OpenClaw gateway token from mounted config', {
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

export function configureOpenClawService(
  config: OpenClawServiceConfig,
): OpenClawService {
  if (!service) {
    service = new OpenClawService(config)
    return service
  }

  service.configure(config)
  return service
}

export function getOpenClawService(): OpenClawService {
  if (!service) service = new OpenClawService()
  return service
}
