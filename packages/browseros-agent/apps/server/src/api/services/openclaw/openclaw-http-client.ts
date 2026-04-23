/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { createParser, type EventSourceMessage } from 'eventsource-parser'
import type { OpenClawAgentRecord } from './openclaw-cli-client'

export interface OpenClawSessionSummary {
  key: string
  agentId?: string
  model?: string
  kind?: string
  updatedAt?: number
  messageCount?: number
  [extra: string]: unknown
}

export interface OpenClawListSessionsInput {
  limit?: number
  activeMinutes?: number
  kinds?: string[]
  signal?: AbortSignal
}

export interface OpenClawSessionHistoryMessage {
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  messageId?: string
  messageSeq?: number
  timestamp?: number
}

export interface OpenClawSessionHistory {
  sessionKey: string
  messages: OpenClawSessionHistoryMessage[]
  cursor?: string | null
  hasMore?: boolean
  truncated?: boolean
}

export type OpenClawSessionHistoryEvent =
  | { type: 'history'; data: OpenClawSessionHistory }
  | {
      type: 'message'
      data: {
        sessionKey: string
        message: OpenClawSessionHistoryMessage
        messageId?: string
        messageSeq: number
      }
    }
  | { type: 'error'; data: { message: string } }

type OpenClawSessionHistoryMessageEvent = Extract<
  OpenClawSessionHistoryEvent,
  { type: 'message' }
>

export class OpenClawSessionNotFoundError extends Error {
  constructor(readonly sessionKey: string) {
    super(`OpenClaw session not found: ${sessionKey}`)
    this.name = 'OpenClawSessionNotFoundError'
  }
}

type RawAgentRow = {
  id: string
  name?: string
  workspace?: string
  model?: string
}

type AgentsListResult = RawAgentRow[] | { agents?: RawAgentRow[] }

type ToolResponse<T> =
  | { ok: true; result: T }
  | { ok: false; error?: { message?: string } }

export class OpenClawHttpClient {
  constructor(private readonly hostPort: number) {}

  async probe(signal?: AbortSignal): Promise<void> {
    const response = await this.request('/v1/models', {
      method: 'GET',
      signal,
    })
    if (!response.ok) {
      throw await toError(response, 'OpenClaw probe failed')
    }
  }

  async listAgents(signal?: AbortSignal): Promise<OpenClawAgentRecord[]> {
    const result = await this.invokeTool<AgentsListResult>(
      'agents_list',
      {},
      signal,
    )
    const rows = Array.isArray(result) ? result : (result.agents ?? [])
    return rows.map((row) => ({
      agentId: row.id,
      name: row.name ?? row.id,
      workspace: row.workspace ?? '',
      model: row.model,
    }))
  }

  async listSessions(
    input: OpenClawListSessionsInput = {},
  ): Promise<OpenClawSessionSummary[]> {
    const args: Record<string, unknown> = {}
    if (input.limit !== undefined) {
      args.limit = input.limit
    }
    if (input.activeMinutes !== undefined) {
      args.activeMinutes = input.activeMinutes
    }
    if (input.kinds !== undefined) {
      args.kinds = input.kinds
    }

    return this.invokeTool<OpenClawSessionSummary[]>(
      'sessions_list',
      args,
      input.signal,
    )
  }

  async getSessionHistory(
    sessionKey: string,
    input: {
      limit?: number
      cursor?: string
      signal?: AbortSignal
    } = {},
  ): Promise<OpenClawSessionHistory> {
    const response = await this.request(
      this.buildHistoryPath(sessionKey, input),
      {
        method: 'GET',
        signal: input.signal,
      },
    )

    if (response.status === 404) {
      throw new OpenClawSessionNotFoundError(sessionKey)
    }
    if (!response.ok) {
      throw await toError(response, 'OpenClaw session history failed')
    }

    return (await response.json()) as OpenClawSessionHistory
  }

  async streamSessionHistory(
    sessionKey: string,
    input: {
      limit?: number
      cursor?: string
      signal?: AbortSignal
    } = {},
  ): Promise<ReadableStream<OpenClawSessionHistoryEvent>> {
    const response = await this.request(
      this.buildHistoryPath(sessionKey, input),
      {
        method: 'GET',
        headers: { Accept: 'text/event-stream' },
        signal: input.signal,
      },
    )

    if (response.status === 404) {
      throw new OpenClawSessionNotFoundError(sessionKey)
    }
    if (!response.ok || !response.body) {
      throw await toError(response, 'OpenClaw session history stream failed')
    }

    return createHistoryEventStream(response.body, input.signal)
  }

  protected request(path: string, init: RequestInit): Promise<Response> {
    return fetch(`http://127.0.0.1:${this.hostPort}${path}`, init)
  }

  private async invokeTool<T>(
    tool: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<T> {
    const response = await this.request('/tools/invoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tool, args }),
      signal,
    })

    if (!response.ok) {
      throw await toError(response, `OpenClaw tool '${tool}' failed`)
    }

    const body = (await response.json()) as ToolResponse<T>
    if (!body.ok) {
      throw new Error(body.error?.message ?? `OpenClaw tool '${tool}' failed`)
    }

    return body.result
  }

  private buildHistoryPath(
    sessionKey: string,
    input: { limit?: number; cursor?: string },
  ): string {
    const params = new URLSearchParams()
    if (input.limit !== undefined) {
      params.set('limit', String(Number(input.limit)))
    }
    if (input.cursor !== undefined) {
      params.set('cursor', input.cursor)
    }
    const query = params.toString()
    const suffix = query ? `?${query}` : ''
    return `/sessions/${encodeURIComponent(sessionKey)}/history${suffix}`
  }
}

async function toError(response: Response, fallback: string): Promise<Error> {
  const detail = await readErrorDetail(response)
  return new Error(detail || `${fallback} (HTTP ${response.status})`)
}

function createHistoryEventStream(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): ReadableStream<OpenClawSessionHistoryEvent> {
  return new ReadableStream<OpenClawSessionHistoryEvent>({
    start(controller) {
      void pumpHistoryEvents(body, controller, signal)
    },
  })
}

async function pumpHistoryEvents(
  body: ReadableStream<Uint8Array>,
  controller: ReadableStreamDefaultController<OpenClawSessionHistoryEvent>,
  signal?: AbortSignal,
): Promise<void> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let closed = false

  const close = () => {
    if (closed) return
    closed = true
    controller.close()
  }

  const abort = () => {
    void reader
      .cancel()
      .catch(() => undefined)
      .finally(close)
  }

  signal?.addEventListener('abort', abort, { once: true })

  const parser = createParser({
    onEvent(message) {
      if (closed) return

      try {
        const event = parseHistoryEvent(message)
        if (event) {
          controller.enqueue(event)
        }
      } catch (error) {
        controller.enqueue({
          type: 'error',
          data: {
            message: error instanceof Error ? error.message : String(error),
          },
        })
        close()
      }
    },
  })

  try {
    while (!closed) {
      if (signal?.aborted) {
        await reader.cancel().catch(() => undefined)
        close()
        return
      }

      const { done, value } = await reader.read()
      if (done) break
      parser.feed(decoder.decode(value, { stream: true }))
    }

    close()
  } catch (error) {
    if (!closed && !signal?.aborted) {
      controller.enqueue({
        type: 'error',
        data: {
          message: error instanceof Error ? error.message : String(error),
        },
      })
      close()
    }
  } finally {
    signal?.removeEventListener('abort', abort)
    reader.releaseLock()
  }
}

function parseHistoryEvent(
  message: EventSourceMessage,
): OpenClawSessionHistoryEvent | null {
  switch (message.event) {
    case 'history':
      return {
        type: 'history',
        data: JSON.parse(message.data) as OpenClawSessionHistory,
      }
    case 'message':
      return {
        type: 'message',
        data: JSON.parse(
          message.data,
        ) as OpenClawSessionHistoryMessageEvent['data'],
      }
    case 'error':
      return {
        type: 'error',
        data: JSON.parse(message.data) as { message: string },
      }
    default:
      return null
  }
}

async function readErrorDetail(response: Response): Promise<string> {
  const detail = await response.text().catch(() => '')
  if (!detail) {
    return ''
  }

  try {
    return extractErrorMessage(JSON.parse(detail)) ?? detail
  } catch {
    return detail
  }
}

function extractErrorMessage(value: unknown): string | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const message = (value as { message?: unknown }).message
  if (typeof message === 'string' && message) {
    return message
  }

  const error = (value as { error?: { message?: unknown } }).error
  return typeof error?.message === 'string' && error.message
    ? error.message
    : null
}
