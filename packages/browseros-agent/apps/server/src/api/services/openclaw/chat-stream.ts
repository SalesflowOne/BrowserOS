/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { logger } from '../../../lib/logger'
import { OPERATOR_SCOPES, type OpenClawStreamEvent } from './gateway-client'

interface OpenAiChunk {
  choices?: Array<{
    delta?: { content?: string; role?: string }
  }>
}

export function parseOpenAiSseEvent(chunk: unknown): OpenClawStreamEvent[] {
  if (!chunk || typeof chunk !== 'object') return []
  const c = chunk as OpenAiChunk
  const out: OpenClawStreamEvent[] = []
  const choice = c.choices?.[0]
  if (!choice) return out
  const delta = choice.delta?.content
  if (typeof delta === 'string' && delta.length > 0) {
    out.push({ type: 'text-delta', data: { text: delta } })
  }
  return out
}

export function chatStreamHttp(input: {
  httpBase: string
  agentId: string
  sessionKey: string
  message: string
}): ReadableStream<OpenClawStreamEvent> {
  const { httpBase, agentId, sessionKey, message } = input
  const fullSessionKey = `agent:${agentId}:browseros-${sessionKey}`

  return new ReadableStream<OpenClawStreamEvent>({
    start: async (controller) => {
      let res: Response
      try {
        res = await fetch(`${httpBase}/v1/chat/completions`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            accept: 'text/event-stream',
            'x-openclaw-agent-id': agentId,
            'x-openclaw-session-key': fullSessionKey,
            'x-openclaw-scopes': OPERATOR_SCOPES.join(','),
          },
          body: JSON.stringify({
            model: 'openclaw/default',
            stream: true,
            messages: [{ role: 'user', content: message }],
          }),
        })
      } catch (err) {
        controller.enqueue({
          type: 'error',
          data: {
            message: err instanceof Error ? err.message : 'fetch failed',
          },
        })
        controller.close()
        return
      }

      if (!res.ok || !res.body) {
        controller.enqueue({
          type: 'error',
          data: { message: `Gateway HTTP ${res.status}` },
        })
        controller.close()
        return
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      try {
        while (true) {
          const { value, done } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          let sepIdx = buffer.indexOf('\n\n')
          while (sepIdx !== -1) {
            const rawEvent = buffer.slice(0, sepIdx)
            buffer = buffer.slice(sepIdx + 2)
            for (const line of rawEvent.split('\n')) {
              if (!line.startsWith('data:')) continue
              const data = line.slice(5).trim()
              if (data === '[DONE]') {
                controller.enqueue({ type: 'done', data: { text: '' } })
                controller.close()
                return
              }
              try {
                for (const ev of parseOpenAiSseEvent(JSON.parse(data))) {
                  controller.enqueue(ev)
                }
              } catch (err) {
                logger.debug('Chat SSE parse skipped', {
                  error: err instanceof Error ? err.message : String(err),
                })
              }
            }
            sepIdx = buffer.indexOf('\n\n')
          }
        }
        controller.close()
      } finally {
        await reader.cancel().catch(() => {})
      }
    },
  })
}
