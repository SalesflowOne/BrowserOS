/**
 * @license
 * Copyright 2025 BrowserOS
 */

import { afterEach, describe, expect, it, mock } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { OPENCLAW_CONTAINER_HOME } from '@browseros/shared/constants/openclaw'
import { OpenClawService } from '../../../../src/api/services/openclaw/openclaw-service'

type MutableOpenClawService = OpenClawService & {
  openclawDir: string
  token: string
  runtime: {
    ensureReady?: () => Promise<void>
    isPodmanAvailable?: () => Promise<boolean>
    getMachineStatus?: () => Promise<{ initialized: boolean; running: boolean }>
    isReady: () => Promise<boolean>
    copyComposeFile?: (_source: string) => Promise<void>
    writeEnvFile?: (_content: string) => Promise<void>
    composePull?: () => Promise<void>
    composeUp?: () => Promise<void>
    waitForReady?: () => Promise<boolean>
  }
  adminClient: {
    probe?: ReturnType<typeof mock>
    createAgent?: ReturnType<typeof mock>
    listAgents?: ReturnType<typeof mock>
  }
}

describe('OpenClawService', () => {
  let tempDir: string | null = null

  afterEach(async () => {
    mock.restore()
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true })
      tempDir = null
    }
  })

  it('creates agents through the admin client and writes role bootstrap files', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'openclaw-service-'))
    const createAgent = mock(async () => ({
      agentId: 'ops',
      name: 'ops',
      workspace: `${OPENCLAW_CONTAINER_HOME}/workspace-ops`,
      model: 'openclaw/default',
    }))
    const service = new OpenClawService() as MutableOpenClawService

    service.openclawDir = tempDir
    service.runtime = {
      isReady: async () => true,
    }
    service.adminClient = {
      createAgent,
    }

    const agent = await service.createAgent({
      name: 'ops',
      roleId: 'chief-of-staff',
    })

    expect(createAgent).toHaveBeenCalledWith({
      name: 'ops',
      model: undefined,
    })
    expect(agent.role).toEqual({
      roleSource: 'builtin',
      roleId: 'chief-of-staff',
      roleName: 'Chief of Staff',
      shortDescription:
        'Executive coordination, follow-ups, scheduling, and briefing support.',
    })

    const roleMetadata = JSON.parse(
      await readFile(
        join(tempDir, 'workspace-ops', '.browseros-role.json'),
        'utf-8',
      ),
    ) as {
      roleId: string
      agentName: string
    }
    expect(roleMetadata).toMatchObject({
      roleId: 'chief-of-staff',
      agentName: 'ops',
    })
  })

  it('maps successful admin probes into connected status', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'openclaw-service-'))
    await writeFile(join(tempDir, 'openclaw.json'), '{}')
    const service = new OpenClawService() as MutableOpenClawService

    service.openclawDir = tempDir
    service.runtime = {
      isPodmanAvailable: async () => true,
      getMachineStatus: async () => ({ initialized: true, running: true }),
      isReady: async () => true,
    }
    service.adminClient = {
      listAgents: mock(async () => [
        {
          agentId: 'main',
          name: 'main',
          workspace: `${OPENCLAW_CONTAINER_HOME}/workspace`,
        },
        {
          agentId: 'ops',
          name: 'ops',
          workspace: `${OPENCLAW_CONTAINER_HOME}/workspace-ops`,
        },
      ]),
    }

    const status = await service.getStatus()

    expect(status).toEqual({
      status: 'running',
      podmanAvailable: true,
      machineReady: true,
      port: 18789,
      agentCount: 2,
      error: null,
      controlPlaneStatus: 'connected',
      lastGatewayError: null,
      lastRecoveryReason: null,
    })
  })

  it('creates the main agent during setup when the gateway starts without one', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'openclaw-service-'))
    const createAgent = mock(async () => ({
      agentId: 'main',
      name: 'main',
      workspace: `${OPENCLAW_CONTAINER_HOME}/workspace`,
    }))
    const service = new OpenClawService() as MutableOpenClawService

    service.openclawDir = tempDir
    service.runtime = {
      isPodmanAvailable: async () => true,
      ensureReady: async () => {},
      isReady: async () => true,
      copyComposeFile: async () => {},
      writeEnvFile: async () => {},
      composePull: async () => {},
      composeUp: async () => {},
      waitForReady: async () => true,
    }
    service.adminClient = {
      probe: mock(async () => {}),
      listAgents: mock(async () => []),
      createAgent,
    }

    await service.setup({})

    expect(createAgent).toHaveBeenCalledWith({
      name: 'main',
      model: undefined,
    })
  })

  it('loads the persisted gateway token before control plane calls', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'openclaw-service-'))
    await writeFile(join(tempDir, '.env'), 'OPENCLAW_GATEWAY_TOKEN=env-token\n')
    const service = new OpenClawService() as MutableOpenClawService

    service.openclawDir = tempDir
    service.token = 'random-token'
    service.runtime = {
      isReady: async () => true,
    }
    service.adminClient = {
      listAgents: mock(async () => {
        expect(service.token).toBe('env-token')
        return []
      }),
    }

    await service.listAgents()
  })
})
