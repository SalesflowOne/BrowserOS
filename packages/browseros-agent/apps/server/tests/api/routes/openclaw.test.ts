/**
 * @license
 * Copyright 2025 BrowserOS
 */

import { afterEach, describe, expect, it, mock } from 'bun:test'
import { UnsupportedOpenClawProviderError } from '../../../src/api/services/openclaw/openclaw-provider-map'

describe('createOpenClawRoutes', () => {
  afterEach(() => {
    mock.restore()
  })

  it('preserves BrowserOS SSE framing and session headers for chat', async () => {
    const actualOpenClawService = await import(
      '../../../src/api/services/openclaw/openclaw-service'
    )
    const chatStream = mock(
      async () =>
        new ReadableStream({
          start(controller) {
            controller.enqueue({
              type: 'text-delta',
              data: { text: 'Hello' },
            })
            controller.enqueue({
              type: 'done',
              data: { text: 'Hello' },
            })
            controller.close()
          },
        }),
    )

    mock.module('../../../src/api/services/openclaw/openclaw-service', () => ({
      ...actualOpenClawService,
      getOpenClawService: () =>
        ({
          chatStream,
        }) as never,
    }))

    const { createOpenClawRoutes } = await import(
      '../../../src/api/routes/openclaw'
    )
    const route = createOpenClawRoutes()

    const response = await route.request('/agents/research/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'hi',
        sessionKey: 'session-123',
      }),
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toContain('text/event-stream')
    expect(response.headers.get('X-Session-Key')).toBe('session-123')
    expect(chatStream).toHaveBeenCalledWith('research', 'session-123', 'hi')
    expect(await response.text()).toBe(
      'data: {"type":"text-delta","data":{"text":"Hello"}}\n\n' +
        'data: {"type":"done","data":{"text":"Hello"}}\n\n' +
        'data: [DONE]\n\n',
    )
  })

  it('returns 400 for unsupported provider payloads', async () => {
    const actualOpenClawService = await import(
      '../../../src/api/services/openclaw/openclaw-service'
    )
    const updateProviderKeys = mock(async () => {
      throw new UnsupportedOpenClawProviderError('google')
    })

    mock.module('../../../src/api/services/openclaw/openclaw-service', () => ({
      ...actualOpenClawService,
      getOpenClawService: () =>
        ({
          updateProviderKeys,
        }) as never,
    }))

    const { createOpenClawRoutes } = await import(
      '../../../src/api/routes/openclaw'
    )
    const route = createOpenClawRoutes()

    const response = await route.request('/providers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        providerType: 'google',
        apiKey: 'google-key',
      }),
    })

    expect(response.status).toBe(400)
    expect(updateProviderKeys).toHaveBeenCalledWith({
      providerType: 'google',
      apiKey: 'google-key',
    })
    expect(await response.json()).toEqual({
      error: 'Unsupported OpenClaw provider: google',
    })
  })
})
