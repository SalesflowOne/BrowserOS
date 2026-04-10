/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * WebSocket client for the OpenClaw Gateway protocol.
 * Handles handshake (challenge → connect → hello-ok), JSON-RPC over WS,
 * and auto-reconnect. Used for agent CRUD and health — chat uses HTTP.
 */

import { logger } from '../../lib/logger'

const RPC_TIMEOUT_MS = 15_000
const RECONNECT_DELAY_MS = 2_000
const MAX_RECONNECT_RETRIES = 5
const CONTAINER_HOME = '/home/node/.openclaw'

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (reason: Error) => void
  timer: ReturnType<typeof setTimeout>
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

export interface GatewayAgentEntry {
  agentId: string
  name: string
  workspace: string
  model?: string
}

export class GatewayClient {
  private ws: WebSocket | null = null
  private _connected = false
  private pendingRequests = new Map<string, PendingRequest>()
  private reconnectAttempts = 0
  private shouldReconnect = true
  private version: string

  constructor(
    private port: number,
    private token: string,
    version = '1.0.0',
  ) {
    this.version = version
  }

  get isConnected(): boolean {
    return this._connected
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = `ws://127.0.0.1:${this.port}`
      this.ws = new WebSocket(url)

      let handshakeComplete = false
      let connectReqId: string | null = null

      this.ws.onmessage = (event) => {
        let frame: WsFrame
        try {
          frame = JSON.parse(
            typeof event.data === 'string'
              ? event.data
              : new TextDecoder().decode(event.data as ArrayBuffer),
          )
        } catch {
          return
        }

        // During handshake: wait for challenge, then hello-ok
        if (!handshakeComplete) {
          if (frame.type === 'event' && frame.event === 'connect.challenge') {
            connectReqId = crypto.randomUUID()
            this.ws!.send(
              JSON.stringify({
                type: 'req',
                id: connectReqId,
                method: 'connect',
                params: {
                  minProtocol: 3,
                  maxProtocol: 3,
                  client: {
                    id: 'openclaw-control-ui',
                    version: this.version,
                    platform: process.platform,
                    mode: 'ui',
                  },
                  role: 'operator',
                  scopes: ['operator.read', 'operator.write', 'operator.admin'],
                  auth: { token: this.token },
                  locale: 'en-US',
                  userAgent: `browseros-server/${this.version}`,
                },
              }),
            )
            return
          }

          if (frame.type === 'res' && frame.id === connectReqId) {
            if (frame.ok) {
              handshakeComplete = true
              this._connected = true
              this.reconnectAttempts = 0
              logger.info('Gateway WS connected')
              resolve()
            } else {
              const msg = frame.error?.message ?? 'Handshake failed'
              logger.error('Gateway WS handshake rejected', {
                error: msg,
                code: frame.error?.code,
              })
              reject(new Error(msg))
            }
            return
          }
          return
        }

        // After handshake: route responses and events
        if (frame.type === 'res' && frame.id) {
          const pending = this.pendingRequests.get(frame.id)
          if (pending) {
            this.pendingRequests.delete(frame.id)
            clearTimeout(pending.timer)
            if (frame.ok) {
              pending.resolve(frame.payload)
            } else {
              pending.reject(new Error(frame.error?.message ?? 'RPC error'))
            }
          }
        }
        // Events (tick, health, etc.) — log for now, extend later
      }

      this.ws.onerror = (err) => {
        if (!handshakeComplete) {
          reject(
            new Error(
              `WS connection error: ${err instanceof Error ? err.message : 'unknown'}`,
            ),
          )
        }
      }

      this.ws.onclose = () => {
        this._connected = false
        this.rejectAllPending('WebSocket closed')
        if (handshakeComplete) {
          logger.info('Gateway WS disconnected')
          this.tryReconnect()
        }
      }
    })
  }

  disconnect(): void {
    this.shouldReconnect = false
    this._connected = false
    this.rejectAllPending('Client disconnecting')
    if (this.ws) {
      this.ws.onclose = null
      this.ws.close()
      this.ws = null
    }
  }

  // ── RPC ──────────────────────────────────────────────────────────────

  async rpc<T = Record<string, unknown>>(
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<T> {
    if (!this._connected || !this.ws) {
      throw new Error('Gateway WS not connected')
    }

    const id = crypto.randomUUID()

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id)
        reject(new Error(`RPC timeout: ${method}`))
      }, RPC_TIMEOUT_MS)

      this.pendingRequests.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timer,
      })

      this.ws!.send(JSON.stringify({ type: 'req', id, method, params }))
    })
  }

  // ── Agent Methods ────────────────────────────────────────────────────

  async listAgents(): Promise<GatewayAgentEntry[]> {
    const result = await this.rpc<{ agents: GatewayAgentEntry[] }>(
      'agents.list',
    )
    return result.agents ?? []
  }

  async createAgent(input: {
    name: string
    workspace: string
    model?: string
  }): Promise<GatewayAgentEntry> {
    return this.rpc<GatewayAgentEntry>('agents.create', input)
  }

  async deleteAgent(agentId: string): Promise<void> {
    await this.rpc('agents.delete', { id: agentId })
  }

  // ── Health ───────────────────────────────────────────────────────────

  async getHealth(): Promise<Record<string, unknown>> {
    return this.rpc('health')
  }

  // ── Helpers ──────────────────────────────────────────────────────────

  static agentWorkspace(name: string): string {
    return name === 'main'
      ? `${CONTAINER_HOME}/workspace`
      : `${CONTAINER_HOME}/workspace-${name}`
  }

  private tryReconnect(): void {
    if (!this.shouldReconnect) return
    if (this.reconnectAttempts >= MAX_RECONNECT_RETRIES) {
      logger.warn('Gateway WS max reconnect attempts reached')
      return
    }

    this.reconnectAttempts++
    logger.info('Gateway WS reconnecting...', {
      attempt: this.reconnectAttempts,
    })

    setTimeout(() => {
      this.connect().catch((err) => {
        logger.warn('Gateway WS reconnect failed', {
          error: err instanceof Error ? err.message : String(err),
          attempt: this.reconnectAttempts,
        })
      })
    }, RECONNECT_DELAY_MS)
  }

  private rejectAllPending(reason: string): void {
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timer)
      pending.reject(new Error(reason))
      this.pendingRequests.delete(id)
    }
  }
}
