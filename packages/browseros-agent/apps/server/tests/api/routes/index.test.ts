/**
 * @license
 * Copyright 2025 BrowserOS
 */

import { describe, expect, it, mock } from 'bun:test'
import { Hono } from 'hono'
import type { Env } from '../../../src/api/types'

mock.module('../../../src/lib/mcp-manager', () => ({
  humaniseInstallError: (err: unknown) => ({
    message: err instanceof Error ? err.message : String(err),
    status: 500,
  }),
  installInto: mock(async () => ({ success: true })),
  listAgents: mock(async () => []),
  uninstallFrom: mock(async () => ({ success: true })),
}))

const { createApiRoutes } = await import('../../../src/api/routes')

function createTestConfig() {
  return {
    port: 32123,
    version: '0.0.0-test',
    browser: {
      isCdpConnected: () => false,
    },
    browserSession: {},
    executionDir: '/tmp/browseros-test',
    resourcesDir: '/tmp/browseros-resources',
    aiSdkDevtoolsEnabled: false,
  } as never
}

function createTestApp() {
  return createApiRoutes({
    agentRoutes: new Hono<Env>(),
    config: createTestConfig(),
    klavisRef: { handle: null },
    remoteHermes: null,
    tokenManager: null,
    onShutdown: () => {},
  })
}

describe('createApiRoutes', () => {
  it('mounts the health route', async () => {
    const response = await createTestApp().request('/health')

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      status: 'ok',
      cdpConnected: false,
    })
  })

  it('preserves the OAuth unavailable fallback', async () => {
    const response = await createTestApp().request('/oauth/openai/status')

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({
      error: 'OAuth not available',
    })
  })

  it('mounts the MCP manager routes', async () => {
    const response = await createTestApp().request('/mcp-manager/agents')

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ agents: [] })
  })
})
