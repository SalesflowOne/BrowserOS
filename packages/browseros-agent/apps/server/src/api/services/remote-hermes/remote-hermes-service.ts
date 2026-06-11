/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * High-level Remote Hermes service. Owns the lifetime of the WS bridge
 * and exposes a small set of methods the HTTP routes orchestrate:
 *
 *   - warm()      → fire-and-forget /v1/laptop/vm/start
 *   - teardown()  → fire-and-forget /v1/laptop/vm/destroy
 *   - status()    → /v1/laptop/vm/status (passthrough)
 *   - streamTurn  → AI SDK UIMessageStreamResponse from a chat turn
 *   - close()     → graceful WS shutdown (called from Application.shutdown)
 *
 * No env / JWT / fetch lives here — those are all in RemoteHermesClient.
 */

import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  type UIMessageStreamWriter,
} from 'ai'
import {
  COLD_START_BUDGET_MS,
  STATUS_POLL_INTERVAL_MS,
} from '../../../lib/clients/remote-hermes/constants'
import { WorkerEventTranslator } from '../../../lib/clients/remote-hermes/event-translator'
import type {
  RemoteHermesClient,
  VmStatusView,
} from '../../../lib/clients/remote-hermes/remote-hermes-client'
import { WsBridge } from '../../../lib/clients/remote-hermes/ws-bridge'
import { logger } from '../../../lib/logger'

const MODULE = 'remote-hermes'

export interface RemoteHermesServiceDeps {
  client: RemoteHermesClient
  resolveLocalMcpUrl(server: string): string | null
}

export interface StreamTurnInput {
  conversationId: string
  message: string
  modelId?: string | null
}

export class RemoteHermesService {
  private readonly client: RemoteHermesClient
  private readonly bridge: WsBridge

  constructor(deps: RemoteHermesServiceDeps) {
    this.client = deps.client
    this.bridge = new WsBridge({
      client: deps.client,
      resolveLocalMcpUrl: deps.resolveLocalMcpUrl,
    })
  }

  /** Provider-save side-effect. Best-effort warm-start of the VM. */
  async warm(): Promise<void> {
    const res = await this.client.startVm()
    logger.info('Remote Hermes /vm/start dispatched', {
      module: MODULE,
      status: res.status,
    })
  }

  /** Provider-delete side-effect. Best-effort destroy of the VM. */
  async teardown(): Promise<void> {
    const res = await this.client.destroyVm()
    logger.info('Remote Hermes /vm/destroy dispatched', {
      module: MODULE,
      status: res.status,
    })
  }

  /** Passthrough to the worker. Used by /remote-hermes/status diagnostics. */
  async status(signal?: AbortSignal): Promise<VmStatusView> {
    return this.client.getVmStatus(signal)
  }

  /**
   * The /chat endpoint forwards `remote-hermes` turns here. Returns an
   * AI SDK UIMessageStreamResponse that the side panel reads identically
   * to any other provider's stream.
   */
  streamTurn(input: StreamTurnInput, abortSignal: AbortSignal): Response {
    const stream = createUIMessageStream({
      execute: async ({ writer }) => {
        await this.bridge.withTurn(async () => {
          const taskId = await this.openTurn(input, writer, abortSignal)
          if (!taskId) return
          await this.pumpEvents(taskId, writer, abortSignal)
        })
      },
      onError: (err) =>
        `Remote Hermes error: ${err instanceof Error ? err.message : String(err)}`,
    })
    return createUIMessageStreamResponse({ stream })
  }

  /** For Application.shutdown(). */
  close(): void {
    this.bridge.close()
  }

  /** Diagnostics passthrough. */
  snapshotBridge() {
    return this.bridge.snapshot()
  }

  private async openTurn(
    input: StreamTurnInput,
    writer: UIMessageStreamWriter,
    signal: AbortSignal,
  ): Promise<string | null> {
    // Optimistic: try the turn first. Warm VMs return 200 immediately.
    const first = await this.client.postTurn(input, signal)
    if (first.ok) return readTaskId(first, writer)
    if (first.status !== 503 && first.status !== 409) {
      writeUpstreamError(writer, await first.text(), first.status)
      return null
    }

    // Cold VM: poll /vm/status until running, updating the boot pill.
    logger.debug('Remote Hermes cold response, entering boot poll', {
      module: MODULE,
      status: first.status,
    })
    writeBootStatus(writer, 'booting')
    const ready = await this.pollUntilRunning(writer, signal)
    if (!ready) {
      writeBootStatus(writer, 'error')
      writer.write({
        type: 'error',
        errorText: `Remote Hermes VM did not become ready within ${COLD_START_BUDGET_MS / 1000} seconds. Try sending again.`,
      })
      return null
    }

    const second = await this.client.postTurn(input, signal)
    if (!second.ok) {
      writeUpstreamError(writer, await second.text(), second.status)
      writeBootStatus(writer, 'error')
      return null
    }
    return readTaskId(second, writer)
  }

  private async pollUntilRunning(
    writer: UIMessageStreamWriter,
    signal: AbortSignal,
  ): Promise<boolean> {
    const deadline = Date.now() + COLD_START_BUDGET_MS
    let lastProgress: string | undefined
    while (Date.now() < deadline) {
      if (signal.aborted) return false
      let view: VmStatusView | null = null
      try {
        view = await this.client.getVmStatus(signal)
      } catch (err) {
        if (signal.aborted) return false
        logger.debug('Remote Hermes status poll failed', {
          module: MODULE,
          err: err instanceof Error ? err.message : String(err),
        })
      }
      if (view) {
        if (view.status === 'running') return true
        if (view.status === 'error') {
          logger.warn('Remote Hermes VM error during boot poll', {
            module: MODULE,
            lastError: view.lastError?.message ?? 'unknown',
          })
          return false
        }
        if (view.progress && view.progress !== lastProgress) {
          lastProgress = view.progress
          writeBootStatus(writer, 'booting', view.progress)
        }
      }
      await sleep(STATUS_POLL_INTERVAL_MS, signal)
    }
    logger.warn('Remote Hermes cold-start budget exceeded', {
      module: MODULE,
      budgetMs: COLD_START_BUDGET_MS,
    })
    return false
  }

  private async pumpEvents(
    taskId: string,
    writer: UIMessageStreamWriter,
    clientAbort: AbortSignal,
  ): Promise<void> {
    const translator = new WorkerEventTranslator(writer)
    let firstContentSeen = false
    const dismissBoot = () => {
      if (firstContentSeen) return
      firstContentSeen = true
      writeBootStatus(writer, 'running')
    }

    const upstreamAbort = new AbortController()
    const onClientAbort = () => {
      upstreamAbort.abort()
      void this.client.abortTask(taskId).catch((err) =>
        logger.debug('Remote Hermes abort POST failed', {
          module: MODULE,
          err: err instanceof Error ? err.message : String(err),
        }),
      )
    }
    if (clientAbort.aborted) {
      onClientAbort()
      return
    }
    clientAbort.addEventListener('abort', onClientAbort, { once: true })

    let sseRes: Response
    try {
      sseRes = await this.client.openTaskEvents(taskId, upstreamAbort.signal)
    } catch (err) {
      if (!upstreamAbort.signal.aborted) {
        writer.write({
          type: 'error',
          errorText: `Failed to subscribe to remote events: ${
            err instanceof Error ? err.message : String(err)
          }`,
        })
      }
      translator.flush()
      return
    }

    if (!sseRes.ok || !sseRes.body) {
      writeUpstreamError(writer, await safeReadText(sseRes), sseRes.status)
      translator.flush()
      return
    }

    try {
      for await (const event of parseSseStream(sseRes.body)) {
        if (event.name === 'end') break
        if (event.name !== 'protocol_event') continue
        let parsed: { type: string; payload: unknown } | null = null
        try {
          parsed = JSON.parse(event.data) as { type: string; payload: unknown }
        } catch {
          logger.debug('Remote Hermes bad protocol_event JSON', {
            module: MODULE,
            preview: event.data.slice(0, 120),
          })
          continue
        }
        if (parsed && parsed.type !== 'turn.start') dismissBoot()
        if (parsed) translator.handle(parsed)
      }
    } catch (err) {
      if (!upstreamAbort.signal.aborted) {
        writer.write({
          type: 'error',
          errorText: `Stream interrupted: ${err instanceof Error ? err.message : String(err)}`,
        })
      }
    } finally {
      translator.flush()
    }
  }
}

interface SseEvent {
  name: string
  data: string
}

async function* parseSseStream(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<SseEvent> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        if (buffer.trim()) {
          const ev = parseSseRecord(buffer)
          if (ev) yield ev
        }
        return
      }
      buffer += decoder.decode(value, { stream: true })
      while (true) {
        const idx = buffer.indexOf('\n\n')
        if (idx === -1) break
        const record = buffer.slice(0, idx)
        buffer = buffer.slice(idx + 2)
        const ev = parseSseRecord(record)
        if (ev) yield ev
      }
    }
  } finally {
    reader.releaseLock()
  }
}

function parseSseRecord(record: string): SseEvent | null {
  let name = 'message'
  const dataLines: string[] = []
  for (const line of record.split('\n')) {
    if (!line || line.startsWith(':')) continue
    if (line.startsWith('event:')) {
      name = line.slice(6).trim()
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).replace(/^ /, ''))
    }
  }
  if (dataLines.length === 0) return null
  return { name, data: dataLines.join('\n') }
}

async function readTaskId(
  res: Response,
  writer: UIMessageStreamWriter,
): Promise<string | null> {
  let payload: unknown
  try {
    payload = await res.json()
  } catch {
    writeUpstreamError(writer, 'non-JSON turn response', res.status)
    return null
  }
  if (
    typeof payload === 'object' &&
    payload !== null &&
    typeof (payload as { taskId?: unknown }).taskId === 'string'
  ) {
    return (payload as { taskId: string }).taskId
  }
  writeUpstreamError(writer, 'turn response missing taskId', res.status)
  return null
}

function writeBootStatus(
  writer: UIMessageStreamWriter,
  status: 'booting' | 'running' | 'error',
  progress?: string,
): void {
  writer.write({
    type: 'data-vm-status',
    id: 'remote-hermes-vm-status',
    data: progress ? { status, progress } : { status },
    transient: true,
  })
}

function writeUpstreamError(
  writer: UIMessageStreamWriter,
  text: string,
  status: number,
): void {
  writer.write({
    type: 'error',
    errorText: `Remote Hermes upstream ${status}: ${text.slice(0, 240)}`,
  })
}

async function safeReadText(res: Response): Promise<string> {
  try {
    return await res.text()
  } catch {
    return ''
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const onAbort = () => {
      clearTimeout(t)
      resolve()
    }
    const t = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}
