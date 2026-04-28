/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * HTTP-side client for OpenClaw operations that still go over /v1 HTTP:
 *   - `isAuthenticated()` — health probe used by isGatewayAvailable.
 *   - `getSessionHistory(...)` / `streamSessionHistory(...)` — read history
 *     by session key. (Chat sending moved to WS chat.send via the CLI; see
 *     OpenClawService.chatStream.)
 *
 * The legacy `streamChat()` over /v1/chat/completions was removed when chat
 * migrated to WS — that path doesn't register runs in OpenClaw's abort
 * registry, so chat.abort can't stop them. WS chat.send does, which is what
 * makes the Stop button work end-to-end.
 */

import { createParser, type EventSourceMessage } from 'eventsource-parser'
import { OpenClawSessionNotFoundError } from './errors'

/**
 * OpenAI-compatible content parts for multimodal user messages. Used by the
 * route's attachment validator and translated to OpenClaw chat.send
 * `attachments` shape inside OpenClawService.chatStream.
 */
export type OpenClawChatContentPart =
  | { type: 'text'; text: string }
  | {
      type: 'image_url'
      image_url: { url: string; detail?: 'auto' | 'low' | 'high' }
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

export interface OpenClawSessionHistoryInput {
  limit?: number
  cursor?: string
  signal?: AbortSignal
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

export class OpenClawHttpClient {
  constructor(
    private readonly hostPort: number,
    private readonly getToken: () => Promise<string>,
  ) {}

  async getSessionHistory(
    sessionKey: string,
    input: OpenClawSessionHistoryInput = {},
  ): Promise<OpenClawSessionHistory> {
    const response = await this.fetchSessionHistory(sessionKey, input, {})
    return (await response.json()) as OpenClawSessionHistory
  }

  async streamSessionHistory(
    sessionKey: string,
    input: OpenClawSessionHistoryInput = {},
  ): Promise<ReadableStream<OpenClawSessionHistoryEvent>> {
    const response = await this.fetchSessionHistory(sessionKey, input, {
      Accept: 'text/event-stream',
    })
    const body = response.body
    if (!body) {
      throw new Error('OpenClaw session history stream had no body')
    }
    return createHistoryEventStream(body, input.signal)
  }

  async isAuthenticated(): Promise<boolean> {
    try {
      const token = await this.getToken()
      const response = await fetch(
        `http://127.0.0.1:${this.hostPort}/v1/models`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      )
      return response.ok
    } catch {
      return false
    }
  }

  private async fetchSessionHistory(
    sessionKey: string,
    input: OpenClawSessionHistoryInput,
    extraHeaders: Record<string, string>,
  ): Promise<Response> {
    const token = await this.getToken()
    const response = await fetch(
      `http://127.0.0.1:${this.hostPort}${buildHistoryPath(sessionKey, input)}`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          ...extraHeaders,
        },
        signal: input.signal,
      },
    )

    if (response.status === 404) {
      throw new OpenClawSessionNotFoundError(sessionKey)
    }
    if (!response.ok) {
      const detail = await response.text()
      throw new Error(
        detail ||
          `OpenClaw session history failed with status ${response.status}`,
      )
    }
    return response
  }
}

function buildHistoryPath(
  sessionKey: string,
  input: OpenClawSessionHistoryInput,
): string {
  const qs = new URLSearchParams()
  if (input.limit !== undefined) qs.set('limit', String(input.limit))
  if (input.cursor !== undefined) qs.set('cursor', input.cursor)
  const suffix = qs.toString()
  return `/sessions/${encodeURIComponent(sessionKey)}/history${
    suffix ? `?${suffix}` : ''
  }`
}

function parseChunk(data: string): Record<string, unknown> | null {
  try {
    return JSON.parse(data) as Record<string, unknown>
  } catch {
    return null
  }
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
  const parser = createParser({
    onEvent(message) {
      if (closed) return
      const event = toHistoryEvent(message)
      if (!event) return
      controller.enqueue(event)
      if (event.type === 'error') close()
    },
  })

  const onAbort = () => {
    void reader.cancel().catch(() => {})
    close()
  }
  signal?.addEventListener('abort', onAbort, { once: true })

  try {
    while (true) {
      if (signal?.aborted) {
        await reader.cancel()
        close()
        return
      }
      const { done, value } = await reader.read()
      if (done) break
      parser.feed(decoder.decode(value, { stream: true }))
    }
  } catch (error) {
    if (!closed) {
      controller.enqueue({
        type: 'error',
        data: {
          message: error instanceof Error ? error.message : String(error),
        },
      })
      close()
    }
  } finally {
    signal?.removeEventListener('abort', onAbort)
    close()
    reader.releaseLock()
  }
}

function toHistoryEvent(
  message: EventSourceMessage,
): OpenClawSessionHistoryEvent | null {
  if (!message.event) return null
  const payload = parseChunk(message.data)
  if (!payload) return null
  if (message.event === 'history') {
    return {
      type: 'history',
      data: payload as unknown as OpenClawSessionHistory,
    }
  }
  if (message.event === 'message') {
    return {
      type: 'message',
      data: payload as unknown as {
        sessionKey: string
        message: OpenClawSessionHistoryMessage
        messageId?: string
        messageSeq: number
      },
    }
  }
  if (message.event === 'error') {
    const errMessage =
      typeof payload.message === 'string'
        ? payload.message
        : 'OpenClaw session history stream error'
    return { type: 'error', data: { message: errMessage } }
  }
  return null
}
