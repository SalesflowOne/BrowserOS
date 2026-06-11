/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import ReconnectingWebSocket from 'partysocket/ws'
import { mintLaptopJwt } from './auth'
import {
  CLOSE_CODE_REPLACED,
  IDLE_CLOSE_MS,
  IDLE_SWEEP_INTERVAL_MS,
  MAX_ENQUEUED_MESSAGES,
  OPEN_DEADLINE_MS,
  PING_INTERVAL_MS,
  PONG_TIMEOUT_MS,
  TURN_REFCOUNT_GUARD_MS,
  WS_SUBPROTOCOL,
} from './constants'
import type { RemoteHermesEnv } from './env'
import { encodeFrame, PING_FRAME, parseFrame } from './frames'
import { dispatchRpcRequest } from './rpc-router'

export interface BridgeDeps {
  env: RemoteHermesEnv & { jwtSecret: string }
  browserosId: string
  resolveLocalMcpUrl(server: string): string | null
  log?: (msg: string) => void
}

type SocketState = 'closed' | 'connecting' | 'open'

export class RemoteHermesBridge {
  private socket: ReconnectingWebSocket | null = null
  private openingPromise: Promise<void> | null = null
  private inflightTurns = 0
  private lastActivityAt = 0
  private idleSweepTimer: ReturnType<typeof setInterval> | null = null
  private pingTimer: ReturnType<typeof setInterval> | null = null
  private lastPongAt = 0
  private state: SocketState = 'closed'

  constructor(private readonly deps: BridgeDeps) {}

  async ensureOpen(): Promise<void> {
    if (this.state === 'open') return
    if (this.openingPromise) return this.openingPromise
    this.openingPromise = this.doOpen().finally(() => {
      this.openingPromise = null
    })
    return this.openingPromise
  }

  async withTurn<T>(fn: () => Promise<T>): Promise<T> {
    await this.ensureOpen()
    this.inflightTurns++
    this.touch()
    const guard = setTimeout(() => {
      if (this.inflightTurns > 0) {
        this.inflightTurns = Math.max(0, this.inflightTurns - 1)
        this.log('refcount safety-belt fired — caller leaked a turn')
      }
    }, TURN_REFCOUNT_GUARD_MS)
    try {
      return await fn()
    } finally {
      clearTimeout(guard)
      this.inflightTurns = Math.max(0, this.inflightTurns - 1)
      this.touch()
    }
  }

  /** For tests / shutdown only. */
  forceClose(): void {
    this.stopPings()
    this.stopIdleSweep()
    try {
      this.socket?.close()
    } catch {
      // already closed
    }
    this.socket = null
    this.state = 'closed'
  }

  /** Exposed for diagnostics. */
  snapshot(): {
    state: SocketState
    inflightTurns: number
    lastActivityAt: number
  } {
    return {
      state: this.state,
      inflightTurns: this.inflightTurns,
      lastActivityAt: this.lastActivityAt,
    }
  }

  private async doOpen(): Promise<void> {
    // If a previous doOpen call timed out at OPEN_DEADLINE_MS but the
    // underlying socket is still attempting to connect (partysocket's
    // connectionTimeout is longer than ours), close it now. Otherwise the
    // stale socket can fire 'open' later, flip state on the new socket's
    // behalf, and start a parallel set of pings + idle sweep.
    if (this.socket) {
      try {
        this.socket.close()
      } catch {
        // already closed
      }
      this.socket = null
    }
    this.state = 'connecting'
    const sock = new ReconnectingWebSocket(
      this.deps.env.wsUrl,
      async () => [
        WS_SUBPROTOCOL,
        await mintLaptopJwt({
          browserosId: this.deps.browserosId,
          secret: this.deps.env.jwtSecret,
        }),
      ],
      {
        // partysocket has a flat-delay bug despite README claiming jitter:
        // packages/partysocket/src/ws.ts:127 vs README:174. Lockstep retries
        // across clients after a CF blip — add per-instance jitter ourselves.
        minReconnectionDelay: 1_000 + Math.random() * 2_000,
        maxReconnectionDelay: 30_000,
        reconnectionDelayGrowFactor: 1.5,
        connectionTimeout: 15_000,
        minUptime: 10_000,
        maxEnqueuedMessages: MAX_ENQUEUED_MESSAGES,
      },
    )
    // Default 'blob' fights node-style WS impls. arraybuffer is safe everywhere.
    sock.binaryType = 'arraybuffer'

    // Every handler checks `this.socket === sock` so an event from an
    // orphaned previous socket (one we closed above) can never mutate
    // shared bridge state.
    sock.addEventListener('open', () => {
      if (this.socket !== sock) return
      this.state = 'open'
      this.touch()
      this.startPings()
      this.startIdleSweep()
      this.log(`ws open ${this.deps.env.wsUrl}`)
    })
    sock.addEventListener('close', (ev) => {
      if (this.socket !== sock) return
      this.stopPings()
      const replaced = (ev as CloseEvent).code === CLOSE_CODE_REPLACED
      if (replaced) {
        this.log('ws closed by server (replaced); stopping reconnect')
        try {
          sock.close()
        } catch {
          // already closed
        }
        this.socket = null
        this.state = 'closed'
        return
      }
      this.state = 'connecting'
    })
    sock.addEventListener('error', () => {
      if (this.socket !== sock) return
      // partysocket fires reconnect on its own; just record activity so
      // idle sweep doesn't fire mid-reconnect.
      this.touch()
    })
    sock.addEventListener('message', (ev) => {
      if (this.socket !== sock) return
      this.touch()
      void this.onMessage(ev as MessageEvent).catch((err) =>
        this.log(`onMessage error: ${String(err)}`),
      )
    })

    this.socket = sock

    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => {
        reject(new Error(`ws open timed out after ${OPEN_DEADLINE_MS}ms`))
      }, OPEN_DEADLINE_MS)
      const onOpen = () => {
        clearTimeout(t)
        sock.removeEventListener('open', onOpen)
        resolve()
      }
      sock.addEventListener('open', onOpen)
    })
  }

  private async onMessage(ev: MessageEvent): Promise<void> {
    const raw =
      typeof ev.data === 'string'
        ? ev.data
        : ev.data instanceof ArrayBuffer
          ? new TextDecoder().decode(ev.data)
          : String(ev.data)
    const frame = parseFrame(raw)
    if (!frame) return
    if (frame.type === 'pong') {
      this.lastPongAt = Date.now()
      return
    }
    if (frame.type === 'ping' || frame.type === 'rpc.response') return
    // rpc.request — route to local MCP and send the response back.
    const reply = await dispatchRpcRequest(frame, {
      resolveBaseUrl: this.deps.resolveLocalMcpUrl,
      // v1: use browserosId as a stable per-install scope. Threading per-
      // turn conversationId requires worker-side propagation in the
      // rpc.request frame (design doc Open Item #2).
      scopeId: this.deps.browserosId,
      agentId: 'remote-hermes',
      log: (m) => this.log(m),
    })
    try {
      this.socket?.send(encodeFrame(reply))
      this.touch()
    } catch (err) {
      this.log(`failed to send rpc.response: ${String(err)}`)
    }
  }

  private touch(): void {
    this.lastActivityAt = Date.now()
  }

  private startPings(): void {
    this.stopPings()
    this.lastPongAt = Date.now()
    this.pingTimer = setInterval(() => {
      if (Date.now() - this.lastPongAt > PONG_TIMEOUT_MS) {
        this.log(
          `pong timeout (${Date.now() - this.lastPongAt}ms) — forcing reconnect`,
        )
        try {
          this.socket?.reconnect()
        } catch {
          // close handler will reschedule
        }
        return
      }
      try {
        // CF's setWebSocketAutoResponse intercepts this literal and replies
        // {"type":"pong"} without waking the DO. The static literal matters.
        this.socket?.send(PING_FRAME)
      } catch {
        // close handler will reconnect
      }
    }, PING_INTERVAL_MS)
    this.pingTimer.unref?.()
  }

  private stopPings(): void {
    if (this.pingTimer) clearInterval(this.pingTimer)
    this.pingTimer = null
  }

  private startIdleSweep(): void {
    if (this.idleSweepTimer) return
    this.idleSweepTimer = setInterval(
      () => this.idleSweep(),
      IDLE_SWEEP_INTERVAL_MS,
    )
    this.idleSweepTimer.unref?.()
  }

  private stopIdleSweep(): void {
    if (this.idleSweepTimer) clearInterval(this.idleSweepTimer)
    this.idleSweepTimer = null
  }

  private idleSweep(): void {
    if (!this.socket) return
    if (this.inflightTurns > 0) return
    if (Date.now() - this.lastActivityAt < IDLE_CLOSE_MS) return
    this.log('idle close')
    try {
      this.socket.close(1000, 'idle')
    } catch {
      // already closed
    }
    this.socket = null
    this.state = 'closed'
    this.stopPings()
    this.stopIdleSweep()
  }

  private log(msg: string): void {
    this.deps.log?.(msg) ?? undefined
  }
}

let singleton: RemoteHermesBridge | null = null

export function getBridge(deps: BridgeDeps): RemoteHermesBridge {
  if (!singleton) singleton = new RemoteHermesBridge(deps)
  return singleton
}

/** Test hook only. */
export function resetBridge(): void {
  singleton?.forceClose()
  singleton = null
}
