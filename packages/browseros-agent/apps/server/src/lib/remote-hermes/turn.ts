/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  type UIMessageStreamWriter,
} from 'ai'
import { mintLaptopJwt } from './auth'
import type { RemoteHermesBridge } from './bridge'
import {
  REMOTE_HERMES_AGENT_KIND,
  REMOTE_HERMES_DEFAULT_AGENT_ID,
} from './constants'
import type { RemoteHermesEnv } from './env'
import { WorkerEventTranslator } from './event-translator'

export interface StreamRemoteHermesTurnDeps {
  env: RemoteHermesEnv & { jwtSecret: string }
  browserosId: string
  bridge: RemoteHermesBridge
  log?: (msg: string) => void
}

export interface StreamRemoteHermesTurnInput {
  conversationId: string
  message: string
  modelId?: string | null
  abortSignal: AbortSignal
}

/**
 * Open a turn against the Remote Hermes control plane and stream the
 * results back to the side panel as an AI SDK UI Message stream.
 */
export function streamRemoteHermesTurn(
  input: StreamRemoteHermesTurnInput,
  deps: StreamRemoteHermesTurnDeps,
): Response {
  const log = deps.log ?? noop
  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      await deps.bridge.withTurn(async () => {
        const taskId = await postTurnWithRetry(input, deps, writer, log)
        if (!taskId) return
        await pumpTaskEvents({ taskId, writer, input, deps, log })
      })
    },
    onError: (err) =>
      `Remote Hermes error: ${err instanceof Error ? err.message : String(err)}`,
  })
  return createUIMessageStreamResponse({ stream })
}

// End-to-end cold start measured at ~120s in practice:
//   ~90s Fly machine create + image pull
//   ~5s  agent-runtime-service startup inside the VM
//   ~25s Fly healthcheck + DO status flip to 'running'
// 180s gives us a 50% safety margin without making the user wait
// unbounded on a genuinely stuck provision.
const COLD_START_BUDGET_MS = 180_000
const STATUS_POLL_INTERVAL_MS = 2_000

async function postTurnWithRetry(
  input: StreamRemoteHermesTurnInput,
  deps: StreamRemoteHermesTurnDeps,
  writer: UIMessageStreamWriter,
  log: (msg: string) => void,
): Promise<string | null> {
  const url = `${deps.env.baseUrl}/v1/laptop/threads/${encodeURIComponent(input.conversationId)}/turn`
  const body = JSON.stringify({
    message: input.message,
    agentId: REMOTE_HERMES_DEFAULT_AGENT_ID,
    agentKind: REMOTE_HERMES_AGENT_KIND,
    model: input.modelId ?? null,
  })

  // Optimistic path: try the turn first. Warm VMs return 200 immediately.
  const first = await postTurn(url, body, deps, input.abortSignal)
  if (first.ok) return readTaskId(first, writer)
  if (first.status !== 503 && first.status !== 409) {
    writeUpstreamError(writer, await first.text(), first.status)
    return null
  }

  // Cold VM. Poll /vm/status with the boot pill updating until the worker
  // reports `running`, then retry the turn. Budget capped at COLD_START_BUDGET_MS.
  log(`cold response ${first.status} — entering boot poll`)
  writeBootStatus(writer, 'booting')
  const ready = await pollUntilRunning(deps, writer, input.abortSignal, log)
  if (!ready) {
    writeBootStatus(writer, 'error')
    writer.write({
      type: 'error',
      errorText: `Remote Hermes VM did not become ready within ${COLD_START_BUDGET_MS / 1000} seconds. Try sending again.`,
    })
    return null
  }

  const second = await postTurn(url, body, deps, input.abortSignal)
  if (!second.ok) {
    writeUpstreamError(writer, await second.text(), second.status)
    writeBootStatus(writer, 'error')
    return null
  }
  return readTaskId(second, writer)
}

interface VmStatusView {
  status: string
  progress?: string
  lastError?: { code: string; message: string } | null
}

async function pollUntilRunning(
  deps: StreamRemoteHermesTurnDeps,
  writer: UIMessageStreamWriter,
  signal: AbortSignal,
  log: (msg: string) => void,
): Promise<boolean> {
  const url = `${deps.env.baseUrl}/v1/laptop/vm/status`
  const deadline = Date.now() + COLD_START_BUDGET_MS
  let lastProgress: string | undefined
  while (Date.now() < deadline) {
    if (signal.aborted) return false
    let view: VmStatusView | null = null
    try {
      const jwt = await mintLaptopJwt({
        browserosId: deps.browserosId,
        secret: deps.env.jwtSecret,
      })
      const res = await fetch(url, {
        headers: { authorization: `Bearer ${jwt}` },
        signal,
      })
      if (res.ok) view = (await res.json()) as VmStatusView
    } catch (err) {
      if (signal.aborted) return false
      log(`status poll failed: ${String(err)}`)
    }
    if (view) {
      if (view.status === 'running') return true
      if (view.status === 'error') {
        log(`vm error: ${view.lastError?.message ?? 'unknown'}`)
        return false
      }
      if (view.progress && view.progress !== lastProgress) {
        lastProgress = view.progress
        writeBootStatus(writer, 'booting', view.progress)
      }
    }
    await sleep(STATUS_POLL_INTERVAL_MS, signal)
  }
  log('cold-start budget exceeded')
  return false
}

async function postTurn(
  url: string,
  body: string,
  deps: StreamRemoteHermesTurnDeps,
  signal: AbortSignal,
): Promise<Response> {
  const jwt = await mintLaptopJwt({
    browserosId: deps.browserosId,
    secret: deps.env.jwtSecret,
  })
  return fetch(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${jwt}`,
      'content-type': 'application/json',
    },
    body,
    signal,
  })
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

interface PumpArgs {
  taskId: string
  writer: UIMessageStreamWriter
  input: StreamRemoteHermesTurnInput
  deps: StreamRemoteHermesTurnDeps
  log: (msg: string) => void
}

async function pumpTaskEvents(args: PumpArgs): Promise<void> {
  const { taskId, writer, input, deps, log } = args
  const eventsUrl = `${deps.env.baseUrl}/v1/laptop/tasks/${encodeURIComponent(taskId)}/events`
  const abortUrl = `${deps.env.baseUrl}/v1/laptop/tasks/${encodeURIComponent(taskId)}/abort`
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
    void postAbort(abortUrl, deps).catch((err) =>
      log(`abort POST failed: ${String(err)}`),
    )
  }
  if (input.abortSignal.aborted) {
    onClientAbort()
    return
  }
  input.abortSignal.addEventListener('abort', onClientAbort, { once: true })

  let sseRes: Response
  try {
    const jwt = await mintLaptopJwt({
      browserosId: deps.browserosId,
      secret: deps.env.jwtSecret,
    })
    sseRes = await fetch(eventsUrl, {
      headers: {
        authorization: `Bearer ${jwt}`,
        accept: 'text/event-stream',
      },
      signal: upstreamAbort.signal,
    })
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
        log(`bad protocol_event JSON: ${event.data.slice(0, 120)}`)
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

async function postAbort(
  url: string,
  deps: StreamRemoteHermesTurnDeps,
): Promise<void> {
  const jwt = await mintLaptopJwt({
    browserosId: deps.browserosId,
    secret: deps.env.jwtSecret,
  })
  await fetch(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${jwt}` },
  })
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
    const t = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(t)
      resolve()
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

function noop(): void {}
