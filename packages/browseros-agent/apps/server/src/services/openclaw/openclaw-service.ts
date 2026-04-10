/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Main orchestrator for OpenClaw integration.
 * Container lifecycle via Podman, agent CRUD via Gateway WS RPC,
 * chat via HTTP /v1/chat/completions proxy.
 */

import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { TIMEOUTS } from '@browseros/shared/constants/timeouts'
import { getOpenClawDir } from '../../lib/browseros-dir'
import { logger } from '../../lib/logger'
import { ContainerRuntime } from './container-runtime'
import { type GatewayAgentEntry, GatewayClient } from './gateway-client'
import {
  buildBootstrapConfig,
  buildEnvFile,
  resolveProviderKeys,
} from './openclaw-config'
import { getPodmanRuntime } from './podman-runtime'

const COMPOSE_RESOURCE = resolve(
  import.meta.dir,
  '../../../resources/openclaw-compose.yml',
)
const OPENCLAW_CONFIG_FILE = 'openclaw.json'
const GATEWAY_PORT = 18789
const READY_TIMEOUT_MS = 30_000
const CHAT_TIMEOUT_MS = TIMEOUTS.TOOL_CALL
const AGENT_NAME_PATTERN = /^[a-z][a-z0-9-]*$/

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
}

export interface SetupInput {
  providerType?: string
  apiKey?: string
  modelId?: string
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

export class OpenClawService {
  private runtime: ContainerRuntime
  private gateway: GatewayClient | null = null
  private openclawDir: string
  private port = GATEWAY_PORT
  private token: string
  private lastError: string | null = null

  constructor() {
    this.openclawDir = getOpenClawDir()
    this.runtime = new ContainerRuntime(getPodmanRuntime(), this.openclawDir)
    this.token = crypto.randomUUID()
  }

  // ── Lifecycle ────────────────────────────────────────────────────────

  async setup(input: SetupInput, onLog?: (msg: string) => void): Promise<void> {
    onLog?.('Checking container runtime...')
    const available = await this.runtime.isPodmanAvailable()
    if (!available) {
      throw new Error(
        'Podman is not available. Install Podman to use OpenClaw agents.',
      )
    }

    await this.runtime.ensureReady(onLog)
    onLog?.('Container runtime ready')

    await mkdir(this.openclawDir, { recursive: true })
    await mkdir(join(this.openclawDir, 'workspace'), { recursive: true })

    onLog?.('Copying compose file...')
    await this.runtime.copyComposeFile(COMPOSE_RESOURCE)

    this.token = crypto.randomUUID()
    const providerKeys = resolveProviderKeys(input.providerType, input.apiKey)
    const envContent = buildEnvFile({
      token: this.token,
      configDir: this.openclawDir,
      providerKeys,
    })
    await this.runtime.writeEnvFile(envContent)
    onLog?.('Generated .env file')

    const config = buildBootstrapConfig({
      gatewayPort: this.port,
      gatewayToken: this.token,
      providerType: input.providerType,
      modelId: input.modelId,
    })
    await this.writeBootstrapConfig(config)
    onLog?.('Generated openclaw.json')

    onLog?.('Pulling OpenClaw image...')
    await this.runtime.composePull(onLog)
    onLog?.('Image ready')

    onLog?.('Starting OpenClaw gateway...')
    await this.runtime.composeUp(onLog)

    onLog?.('Waiting for gateway readiness...')
    const ready = await this.runtime.waitForReady(this.port, READY_TIMEOUT_MS)
    if (!ready) {
      this.lastError = 'Gateway did not become ready within 30 seconds'
      const logs = await this.runtime.composeLogs()
      logger.error('Gateway readiness check failed', { logs })
      throw new Error(this.lastError)
    }

    onLog?.('Connecting to gateway...')
    await this.connectGateway()

    onLog?.('Creating main agent...')
    const model =
      input.providerType && input.modelId
        ? `${input.providerType}/${input.modelId}`
        : undefined
    await this.gateway!.createAgent({
      name: 'main',
      workspace: GatewayClient.agentWorkspace('main'),
      model,
    })

    this.lastError = null
    onLog?.(`OpenClaw gateway running at http://127.0.0.1:${this.port}`)
    logger.info('OpenClaw setup complete', { port: this.port })
  }

  async start(onLog?: (msg: string) => void): Promise<void> {
    await this.loadTokenFromEnv()
    await this.runtime.ensureReady(onLog)
    await this.runtime.composeUp(onLog)

    const ready = await this.runtime.waitForReady(this.port, READY_TIMEOUT_MS)
    if (!ready) {
      this.lastError = 'Gateway did not become ready after start'
      throw new Error(this.lastError)
    }

    await this.connectGateway()
    this.lastError = null
  }

  async stop(): Promise<void> {
    this.disconnectGateway()
    await this.runtime.composeStop()
    logger.info('OpenClaw container stopped')
  }

  async restart(onLog?: (msg: string) => void): Promise<void> {
    this.disconnectGateway()
    await this.loadTokenFromEnv()
    onLog?.('Restarting OpenClaw gateway...')
    await this.runtime.composeRestart(onLog)

    const ready = await this.runtime.waitForReady(this.port, READY_TIMEOUT_MS)
    if (!ready) {
      this.lastError = 'Gateway did not become ready after restart'
      throw new Error(this.lastError)
    }

    await this.connectGateway()
    this.lastError = null
    onLog?.('Gateway restarted successfully')
  }

  async shutdown(): Promise<void> {
    this.disconnectGateway()
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
      }
    }

    const isSetUp = existsSync(join(this.openclawDir, OPENCLAW_CONFIG_FILE))
    if (!isSetUp) {
      const machineStatus = await this.runtime.getMachineStatus()
      return {
        status: 'uninitialized',
        podmanAvailable: true,
        machineReady: machineStatus.running,
        port: null,
        agentCount: 0,
        error: null,
      }
    }

    const machineStatus = await this.runtime.getMachineStatus()
    const ready = machineStatus.running
      ? await this.runtime.isReady(this.port)
      : false

    let agentCount = 0
    if (ready && this.gateway?.isConnected) {
      try {
        const agents = await this.gateway.listAgents()
        agentCount = agents.length
      } catch {
        // WS may be momentarily unavailable
      }
    }

    return {
      status: ready ? 'running' : this.lastError ? 'error' : 'stopped',
      podmanAvailable: true,
      machineReady: machineStatus.running,
      port: this.port,
      agentCount,
      error: this.lastError,
    }
  }

  // ── Agent Management (via WS RPC) ───────────────────────────────────

  async createAgent(input: {
    name: string
    providerType?: string
    apiKey?: string
    modelId?: string
  }): Promise<GatewayAgentEntry> {
    const { name } = input
    if (!AGENT_NAME_PATTERN.test(name)) {
      throw new Error(
        'Agent name must start with a lowercase letter and contain only lowercase letters, numbers, and hyphens',
      )
    }

    this.ensureGatewayConnected()

    // Merge new provider API key into .env if needed
    let needsRestart = false
    if (input.providerType && input.apiKey) {
      needsRestart = await this.mergeProviderKeyIfNew(
        input.providerType,
        input.apiKey,
      )
    }

    if (needsRestart) {
      await this.restart()
    }

    const model =
      input.providerType && input.modelId
        ? `${input.providerType}/${input.modelId}`
        : undefined

    const agent = await this.gateway!.createAgent({
      name,
      workspace: GatewayClient.agentWorkspace(name),
      model,
    })

    logger.info('Agent created via WS RPC', {
      agentId: agent.agentId,
      providerType: input.providerType,
    })
    return agent
  }

  async removeAgent(agentId: string): Promise<void> {
    if (agentId === 'main') {
      throw new Error('Cannot delete the main agent')
    }

    this.ensureGatewayConnected()
    await this.gateway!.deleteAgent(agentId)
    logger.info('Agent removed via WS RPC', { agentId })
  }

  async listAgents(): Promise<GatewayAgentEntry[]> {
    this.ensureGatewayConnected()
    return this.gateway!.listAgents()
  }

  // ── Chat Proxy (HTTP) ───────────────────────────────────────────────

  async chat(agentId: string, messages: ChatMessage[]): Promise<Response> {
    await this.loadTokenFromEnv()
    const url = `http://127.0.0.1:${this.port}/v1/chat/completions`

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.token}`,
      },
      body: JSON.stringify({
        model: `openclaw/${agentId}`,
        stream: true,
        messages,
      }),
      signal: AbortSignal.timeout(CHAT_TIMEOUT_MS),
    })

    if (!response.ok) {
      const errText = await response.text()
      throw new Error(`OpenClaw error (${response.status}): ${errText}`)
    }

    return response
  }

  // ── Provider Keys ────────────────────────────────────────────────────

  async updateProviderKeys(
    providerType: string,
    apiKey: string,
  ): Promise<void> {
    await this.mergeProviderKeyIfNew(providerType, apiKey)
    await this.restart()
    logger.info('Provider keys updated', { providerType })
  }

  // ── Logs ─────────────────────────────────────────────────────────────

  async getLogs(tail = 100): Promise<string[]> {
    return this.runtime.composeLogs(tail)
  }

  // ── Auto-start on BrowserOS boot ────────────────────────────────────

  async tryAutoStart(): Promise<void> {
    const isSetUp = existsSync(join(this.openclawDir, OPENCLAW_CONFIG_FILE))
    if (!isSetUp) return

    const available = await this.runtime.isPodmanAvailable()
    if (!available) return

    try {
      await this.loadTokenFromEnv()
      await this.runtime.ensureReady()

      if (await this.runtime.isReady(this.port)) {
        await this.connectGateway()
        logger.info('OpenClaw gateway already running')
        return
      }

      await this.runtime.composeUp()
      const ready = await this.runtime.waitForReady(this.port, READY_TIMEOUT_MS)
      if (ready) {
        await this.connectGateway()
        logger.info('OpenClaw gateway auto-started')
      } else {
        logger.warn('OpenClaw gateway failed to become ready on auto-start')
      }
    } catch (err) {
      logger.warn('OpenClaw auto-start failed', {
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  // ── Internal ─────────────────────────────────────────────────────────

  private async connectGateway(): Promise<void> {
    this.disconnectGateway()
    this.gateway = new GatewayClient(this.port, this.token)
    await this.gateway.connect()
  }

  private disconnectGateway(): void {
    if (this.gateway) {
      this.gateway.disconnect()
      this.gateway = null
    }
  }

  private ensureGatewayConnected(): void {
    if (!this.gateway?.isConnected) {
      throw new Error('Gateway WS not connected')
    }
  }

  private async writeBootstrapConfig(
    config: Record<string, unknown>,
  ): Promise<void> {
    const configPath = join(this.openclawDir, OPENCLAW_CONFIG_FILE)
    await writeFile(configPath, JSON.stringify(config, null, 2))
  }

  /**
   * Merges a provider API key into .env. Returns true if the key was NEW
   * (not previously present), meaning a container restart is needed to
   * pick up the new env var.
   */
  private async mergeProviderKeyIfNew(
    providerType: string,
    apiKey: string,
  ): Promise<boolean> {
    const newKeys = resolveProviderKeys(providerType, apiKey)
    if (Object.keys(newKeys).length === 0) return false

    const envPath = join(this.openclawDir, '.env')
    let content = ''
    try {
      content = await readFile(envPath, 'utf-8')
    } catch {
      // .env may not exist yet
    }

    let addedNew = false
    for (const [key, value] of Object.entries(newKeys)) {
      const pattern = new RegExp(`^${key}=.*$`, 'm')
      if (pattern.test(content)) {
        content = content.replace(pattern, `${key}=${value}`)
      } else {
        content = `${content.trimEnd()}\n${key}=${value}\n`
        addedNew = true
      }
    }

    await writeFile(envPath, content, { mode: 0o600 })
    return addedNew
  }

  private async loadTokenFromEnv(): Promise<void> {
    const envPath = join(this.openclawDir, '.env')
    try {
      const content = await readFile(envPath, 'utf-8')
      const match = content.match(/^OPENCLAW_GATEWAY_TOKEN=(.+)$/m)
      if (match) {
        this.token = match[1]
      }
    } catch {
      // .env may not exist yet
    }
  }
}

let service: OpenClawService | null = null

export function getOpenClawService(): OpenClawService {
  if (!service) service = new OpenClawService()
  return service
}
