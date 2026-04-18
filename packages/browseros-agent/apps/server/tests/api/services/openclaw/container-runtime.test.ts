/**
 * @license
 * Copyright 2025 BrowserOS
 */

import { describe, expect, it } from 'bun:test'
import { ContainerRuntime } from '../../../../src/api/services/openclaw/container-runtime'

describe('ContainerRuntime', () => {
  it('pullImage runs podman pull for the requested image', async () => {
    const calls: Array<{ args: string[]; cwd?: string }> = []
    const runtime = new ContainerRuntime(
      {
        ensureReady: async () => {},
        isPodmanAvailable: async () => true,
        getMachineStatus: async () => ({ initialized: true, running: true }),
        runCommand: async (args, options) => {
          calls.push({ args, cwd: options?.cwd })
          return 0
        },
        tailContainerLogs: () => () => {},
        listRunningContainers: async () => [],
        stopMachine: async () => {},
      } as never,
      '/tmp/openclaw',
    )

    await runtime.pullImage('ghcr.io/openclaw/openclaw:2026.4.12')

    expect(calls).toEqual([
      {
        args: ['pull', 'ghcr.io/openclaw/openclaw:2026.4.12'],
        cwd: '/tmp/openclaw',
      },
    ])
  })
})
