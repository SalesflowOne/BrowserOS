/**
 * @license
 * Copyright 2025 BrowserOS
 */

import { afterEach, describe, expect, it, mock } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CLAUDE_CONTAINER_NAME } from '@browseros/shared/constants/claude'

describe('createTerminalSocketEvents', () => {
  const tempDirs: string[] = []

  afterEach(() => {
    mock.restore()
    return Promise.all(
      tempDirs.map((dir) => rm(dir, { recursive: true, force: true })),
    ).then(() => {
      tempDirs.length = 0
    })
  })

  it('resolves limactl only when a terminal socket opens', async () => {
    const close = mock(() => {})
    const send = mock(() => {})
    const session = {
      close: mock(() => {}),
      resize: mock(() => {}),
      writeInput: mock(() => {}),
    }
    const createTerminalSession = mock(() => session)
    const actualTerminalSession = await import(
      '../../../src/api/services/terminal/terminal-session'
    )

    mock.module('../../../src/api/services/terminal/terminal-session', () => ({
      ...actualTerminalSession,
      createTerminalSession,
    }))

    const { createTerminalSocketEvents } = await import(
      '../../../src/api/routes/terminal'
    )
    const resolveLimactlPath = mock(() => '/tmp/fake-limactl')

    const events = createTerminalSocketEvents({
      browserosDir: '/tmp/browseros',
      containerName: 'gateway',
      limaHome: '/tmp/lima',
      limactlPath: resolveLimactlPath,
      vmName: 'browseros-vm',
    })

    expect(resolveLimactlPath).not.toHaveBeenCalled()

    events.onOpen(new Event('open'), { send, close })

    expect(resolveLimactlPath).toHaveBeenCalledTimes(1)
    expect(createTerminalSession).toHaveBeenCalledWith(
      expect.objectContaining({
        target: expect.objectContaining({ containerName: 'gateway' }),
        limaHome: '/tmp/lima',
        limactlPath: '/tmp/fake-limactl',
        vmName: 'browseros-vm',
      }),
    )
    expect(close).not.toHaveBeenCalled()
  })

  it('opens a Claude terminal target for the selected agent', async () => {
    const browserosDir = await mkdtemp(join(tmpdir(), 'browseros-terminal-'))
    tempDirs.push(browserosDir)
    const close = mock(() => {})
    const send = mock(() => {})
    const session = {
      close: mock(() => {}),
      resize: mock(() => {}),
      writeInput: mock(() => {}),
    }
    const createTerminalSession = mock(() => session)
    const actualTerminalSession = await import(
      '../../../src/api/services/terminal/terminal-session'
    )

    mock.module('../../../src/api/services/terminal/terminal-session', () => ({
      ...actualTerminalSession,
      createTerminalSession,
    }))

    const { createTerminalSocketEvents } = await import(
      '../../../src/api/routes/terminal'
    )
    const events = createTerminalSocketEvents(
      {
        browserosDir,
        containerName: 'gateway',
        limaHome: '/tmp/lima',
        limactlPath: '/tmp/fake-limactl',
        vmName: 'browseros-vm',
      },
      { target: 'claude', agentId: 'agent-1' },
    )

    events.onOpen(new Event('open'), { send, close })

    const agentHome = join(
      browserosDir,
      'vm',
      'claude',
      'harness',
      'agent-1',
      'home',
    )
    expect(createTerminalSession).toHaveBeenCalledWith(
      expect.objectContaining({
        target: expect.objectContaining({
          containerName: CLAUDE_CONTAINER_NAME,
          workingDir: agentHome,
          env: {
            AGENT_HOME: agentHome,
            HOME: agentHome,
          },
        }),
      }),
    )
    expect(close).not.toHaveBeenCalled()
  })

  it('sends an error and closes when the limactl resolver throws', async () => {
    const close = mock(() => {})
    const send = mock(() => {})
    const createTerminalSession = mock(() => {
      throw new Error('should not start a session')
    })
    const actualTerminalSession = await import(
      '../../../src/api/services/terminal/terminal-session'
    )

    mock.module('../../../src/api/services/terminal/terminal-session', () => ({
      ...actualTerminalSession,
      createTerminalSession,
    }))

    const { createTerminalSocketEvents } = await import(
      '../../../src/api/routes/terminal'
    )
    const events = createTerminalSocketEvents({
      browserosDir: '/tmp/browseros',
      containerName: 'gateway',
      limaHome: '/tmp/lima',
      limactlPath: () => {
        throw new Error('limactl not found')
      },
      vmName: 'browseros-vm',
    })

    events.onOpen(new Event('open'), { send, close })

    expect(createTerminalSession).not.toHaveBeenCalled()
    expect(send).toHaveBeenCalledWith(
      JSON.stringify({ type: 'error', message: 'limactl not found' }),
    )
    expect(close).toHaveBeenCalledTimes(1)
  })
})

describe('createTerminalRoutes', () => {
  afterEach(() => {
    mock.restore()
  })

  it('returns running managed terminal targets', async () => {
    const { createTerminalRoutes } = await import(
      '../../../src/api/routes/terminal'
    )
    const route = createTerminalRoutes({
      browserosDir: '/tmp/browseros',
      containerName: 'gateway',
      limaHome: '/tmp/lima',
      limactlPath: '/tmp/fake-limactl',
      vmName: 'browseros-vm',
      listRunningContainers: async () => [CLAUDE_CONTAINER_NAME],
    })

    const res = await route.request('/targets?agentId=agent-1')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      targets: [
        expect.objectContaining({
          id: 'claude',
          containerName: CLAUDE_CONTAINER_NAME,
          running: true,
        }),
      ],
    })
  })
})
