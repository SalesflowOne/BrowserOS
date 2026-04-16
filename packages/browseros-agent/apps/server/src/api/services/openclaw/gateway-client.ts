/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { OPENCLAW_CONTAINER_HOME } from '@browseros/shared/constants/openclaw'
import { logger } from '../../../lib/logger'

const RPC_TIMEOUT_MS = 15_000
const RECONNECT_BASE_MS = 250
const RECONNECT_MAX_MS = 4_000
const RECONNECT_MAX_ATTEMPTS = 5

export const OPERATOR_SCOPES = [
  'operator.admin',
  'operator.read',
  'operator.write',
  'operator.approvals',
  'operator.pairing',
  'operator.talk.secrets',
]

export interface GatewayAgentEntry {
  agentId: string
  name: string
  workspace: string
  model?: string
}

export interface OpenClawStreamEvent {
  type:
    | 'text-delta'
    | 'thinking'
    | 'tool-start'
    | 'tool-end'
    | 'tool-output'
    | 'lifecycle'
    | 'done'
    | 'error'
  data: Record<string, unknown>
}

interface WsFrame {
  type: 'req' | 'res' | 'event'
  id?: string
  method?: string
  params?: Record<string, unknown>
  ok?: boolean
  payload?: Record<string, unknown>
  error?: { message: string; code?: string }
  event?: string
}

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (reason: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export class GatewayClient {
  private ws: WebSocket | null = null
  private _connected = false
  private pending = new Map<string, PendingRequest>()

  constructor(
    private readonly port: number,
    private readonly openclawDir: string,
    private readonly version = '1.0.0',
  ) {}

  get isConnected(): boolean {
    return this._connected
  }

  get endpointHttpBase(): string {
    return `http://127.0.0.1:${this.port}`
  }

  async connect(): Promise<void> {
    this.ws = new WebSocket(`ws://127.0.0.1:${this.port}`, {
      headers: { Origin: `http://127.0.0.1:${this.port}` },
    } as unknown as string[])

    return new Promise((resolve, reject) => {
      const id = globalThis.crypto.randomUUID()
      let settled = false

      this.ws!.onmessage = (event) => {
        const frame = parseFrame(event.data)
        if (!frame) return
        if (!this._connected) {
          if (frame.type === 'res' && frame.id === id) {
            settled = true
            if (frame.ok) {
              this._connected = true
              logger.info('Gateway WS connected', { port: this.port })
              resolve()
            } else {
              const msg = frame.error?.message ?? 'Handshake failed'
              reject(new Error(msg))
            }
            return
          }
          return
        }
        this.dispatchRpcResponse(frame)
      }

      this.ws!.onerror = (err) => {
        const msg = err instanceof Error ? err.message : 'unknown'
        logger.warn('Gateway WS socket error', { error: msg })
        if (!settled) reject(new Error(`WS connection error: ${msg}`))
      }

      this.ws!.onclose = () => {
        this._connected = false
        this.rejectAllPending('WebSocket closed')
        this.ws = null
      }

      this.ws!.onopen = () => {
        this.ws!.send(
          JSON.stringify({
            type: 'req',
            id,
            method: 'connect',
            params: {
              minProtocol: 3,
              maxProtocol: 3,
              client: {
                id: 'control-ui',
                version: this.version,
                platform: process.platform,
                mode: 'cli',
              },
              role: 'operator',
              scopes: OPERATOR_SCOPES,
              caps: [],
              commands: [],
              permissions: {},
              locale: 'en-US',
              userAgent: `browseros-server/${this.version}`,
            },
          }),
        )
      }
    })
  }

  disconnect(): void {
    this._connected = false
    this.rejectAllPending('Client disconnecting')
    if (this.ws) {
      this.ws.onclose = null
      this.ws.close()
      this.ws = null
    }
  }

  async rpc<T = Record<string, unknown>>(
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<T> {
    if (!this._connected || !this.ws) {
      throw new Error('Gateway WS not connected')
    }
    const id = globalThis.crypto.randomUUID()
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`RPC timeout: ${method}`))
      }, RPC_TIMEOUT_MS)
      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timer,
      })
      this.ws?.send(JSON.stringify({ type: 'req', id, method, params }))
    })
  }

  async listAgents(): Promise<GatewayAgentEntry[]> {
    const result = await this.rpc<{
      agents: Array<{
        id: string
        name?: string
        workspace: string
        model?: string
      }>
    }>('agents.list')
    return (result.agents ?? []).map((a) => ({
      agentId: a.id,
      name: a.name ?? a.id,
      workspace: a.workspace,
      model: a.model,
    }))
  }

  async createAgent(input: {
    name: string
    workspace: string
    model?: string
  }): Promise<GatewayAgentEntry> {
    const result = await this.rpc<{
      agentId?: string
      id?: string
      name?: string
      workspace?: string
      model?: string
    }>('agents.create', input)
    return {
      agentId: result.agentId ?? result.id ?? input.name,
      name: result.name ?? input.name,
      workspace: result.workspace ?? input.workspace,
      model: result.model ?? input.model,
    }
  }

  async deleteAgent(agentId: string): Promise<void> {
    await this.rpc('agents.delete', { id: agentId })
  }

  async getHealth(): Promise<Record<string, unknown>> {
    return this.rpc('health')
  }

  static agentWorkspace(name: string): string {
    return name === 'main'
      ? `${OPENCLAW_CONTAINER_HOME}/workspace`
      : `${OPENCLAW_CONTAINER_HOME}/workspace-${name}`
  }

  private dispatchRpcResponse(frame: WsFrame): void {
    if (frame.type !== 'res' || !frame.id) return
    const entry = this.pending.get(frame.id)
    if (!entry) return
    this.pending.delete(frame.id)
    clearTimeout(entry.timer)
    if (frame.ok) entry.resolve(frame.payload)
    else entry.reject(new Error(frame.error?.message ?? 'RPC error'))
  }

  private rejectAllPending(reason: string): void {
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer)
      entry.reject(new Error(reason))
    }
    this.pending.clear()
  }
}

function parseFrame(data: unknown): WsFrame | null {
  try {
    return JSON.parse(
      typeof data === 'string'
        ? data
        : new TextDecoder().decode(data as ArrayBuffer),
    ) as WsFrame
  } catch {
    return null
  }
}

export async function connectWithRetry(
  port: number,
  openclawDir: string,
): Promise<GatewayClient> {
  let attempt = 0
  let delay = RECONNECT_BASE_MS
  let lastError: Error | null = null
  while (attempt < RECONNECT_MAX_ATTEMPTS) {
    try {
      const client = new GatewayClient(port, openclawDir)
      await client.connect()
      return client
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
      attempt += 1
      if (attempt >= RECONNECT_MAX_ATTEMPTS) break
      logger.warn('Gateway connect attempt failed, retrying', {
        attempt,
        delay,
        error: lastError.message,
      })
      await Bun.sleep(delay)
      delay = Math.min(delay * 2, RECONNECT_MAX_MS)
    }
  }
  throw lastError ?? new Error('Gateway connect failed')
}
