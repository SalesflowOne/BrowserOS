/**
 * @license
 * Copyright 2025 BrowserOS
 */

import { afterEach, describe, expect, it, mock } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { OPENCLAW_CONTAINER_HOME } from '@browseros/shared/constants/openclaw'
import { resolveOpenClawProvider } from '../../../../src/api/services/openclaw/openclaw-env'
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
    composeRestart?: () => Promise<void>
    composeUp?: () => Promise<void>
    waitForReady?: () => Promise<boolean>
  }
  cliClient: {
    probe?: ReturnType<typeof mock>
    createAgent?: ReturnType<typeof mock>
    getConfig?: ReturnType<typeof mock>
    listAgents?: ReturnType<typeof mock>
    runOnboard?: ReturnType<typeof mock>
    setConfig?: ReturnType<typeof mock>
    setDefaultModel?: ReturnType<typeof mock>
    validateConfig?: ReturnType<typeof mock>
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

  it('creates agents through the cli client and writes role bootstrap files', async () => {
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
    service.cliClient = {
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
        join(tempDir, '.openclaw', 'workspace-ops', '.browseros-role.json'),
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

  it('maps successful cli client probes into connected status', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'openclaw-service-'))
    await mkdir(join(tempDir, '.openclaw'), { recursive: true })
    await writeFile(join(tempDir, '.openclaw', 'openclaw.json'), '{}')
    const service = new OpenClawService() as MutableOpenClawService

    service.openclawDir = tempDir
    service.runtime = {
      isPodmanAvailable: async () => true,
      getMachineStatus: async () => ({ initialized: true, running: true }),
      isReady: async () => true,
    }
    service.cliClient = {
      getConfig: mock(async () => 'cli-token'),
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
    const runOnboard = mock(async () => {})
    const setConfig = mock(async () => {})
    const setDefaultModel = mock(async () => {})
    const validateConfig = mock(async () => ({ ok: true }))
    const getConfig = mock(async (path: string) => {
      if (path === 'gateway.auth.token') return 'cli-token'
      return null
    })
    const createAgent = mock(async () => ({
      agentId: 'main',
      name: 'main',
      workspace: `${OPENCLAW_CONTAINER_HOME}/workspace`,
    }))
    const writeEnvFile = mock(async (_content: string) => {})
    const service = new OpenClawService() as MutableOpenClawService

    service.openclawDir = tempDir
    service.runtime = {
      isPodmanAvailable: async () => true,
      ensureReady: async () => {},
      isReady: async () => true,
      copyComposeFile: async () => {},
      writeEnvFile,
      composePull: async () => {},
      composeRestart: async () => {},
      composeUp: async () => {},
      waitForReady: async () => true,
    }
    service.cliClient = {
      getConfig,
      probe: mock(async () => {}),
      listAgents: mock(async () => []),
      createAgent,
      runOnboard,
      setConfig,
      setDefaultModel,
      validateConfig,
    }

    await service.setup({})

    expect(runOnboard).toHaveBeenCalledWith({
      acceptRisk: true,
      authChoice: 'skip',
      gatewayAuth: 'token',
      gatewayBind: 'lan',
      gatewayPort: 18789,
      mode: 'local',
      nonInteractive: true,
      skipHealth: true,
    })
    expect(validateConfig).toHaveBeenCalled()
    expect(getConfig).toHaveBeenCalledWith('gateway.auth.token')
    expect(createAgent).toHaveBeenCalledWith({
      name: 'main',
      model: undefined,
    })
    expect(writeEnvFile).toHaveBeenCalledWith(
      expect.stringContaining(`OPENCLAW_HOST_HOME=${tempDir}`),
    )
  })

  it('loads the persisted gateway token through cli config before control plane calls', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'openclaw-service-'))
    await mkdir(join(tempDir, '.openclaw'), { recursive: true })
    await writeFile(join(tempDir, '.openclaw', 'openclaw.json'), '{}')
    const service = new OpenClawService() as MutableOpenClawService

    service.openclawDir = tempDir
    service.token = 'random-token'
    service.runtime = {
      isReady: async () => true,
    }
    service.cliClient = {
      getConfig: mock(async (path: string) => {
        expect(path).toBe('gateway.auth.token')
        return 'cli-token'
      }),
      listAgents: mock(async () => {
        expect(service.token).toBe('cli-token')
        return []
      }),
    }

    await service.listAgents()
  })

  it('writes provider credentials into the mounted state env file during setup', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'openclaw-service-'))
    const service = new OpenClawService() as MutableOpenClawService

    service.openclawDir = tempDir
    service.runtime = {
      isPodmanAvailable: async () => true,
      ensureReady: async () => {},
      isReady: async () => true,
      copyComposeFile: async () => {},
      writeEnvFile: async () => {},
      composePull: async () => {},
      composeRestart: async () => {},
      composeUp: async () => {},
      waitForReady: async () => true,
    }
    service.cliClient = {
      runOnboard: mock(async () => {}),
      setConfig: mock(async () => {}),
      setDefaultModel: mock(async () => {}),
      validateConfig: mock(async () => ({ ok: true })),
      getConfig: mock(async (path: string) =>
        path === 'gateway.auth.token' ? 'cli-token' : null,
      ),
      probe: mock(async () => {}),
      listAgents: mock(async () => [
        {
          agentId: 'main',
          name: 'main',
          workspace: `${OPENCLAW_CONTAINER_HOME}/workspace`,
        },
      ]),
      createAgent: mock(async () => {
        throw new Error('createAgent should not be called when main exists')
      }),
    }

    await service.setup({
      providerType: 'openai',
      apiKey: 'sk-test',
      modelId: 'gpt-5.4-mini',
    })

    expect(
      await readFile(join(tempDir, '.openclaw', '.env'), 'utf-8'),
    ).toContain('OPENAI_API_KEY=sk-test')
  })

  it('keeps openrouter model refs verbatim without rewriting dots', () => {
    const provider = resolveOpenClawProvider({
      providerType: 'openrouter',
      apiKey: 'or-key',
      modelId: 'anthropic/claude-haiku-4.5',
    })

    expect(provider).toEqual({
      envValues: {
        OPENROUTER_API_KEY: 'or-key',
      },
      model: 'openrouter/anthropic/claude-haiku-4.5',
    })
  })

  it('only resolves env vars for the supported bootstrap providers', () => {
    expect(
      resolveOpenClawProvider({
        providerType: 'anthropic',
        apiKey: 'ant-key',
        modelId: 'claude-sonnet-4.5',
      }),
    ).toEqual({
      envValues: {
        ANTHROPIC_API_KEY: 'ant-key',
      },
      model: 'anthropic/claude-sonnet-4.5',
    })

    expect(
      resolveOpenClawProvider({
        providerType: 'moonshot',
        apiKey: 'moon-key',
        modelId: 'kimi-k2',
      }),
    ).toEqual({
      envValues: {
        MOONSHOT_API_KEY: 'moon-key',
      },
      model: 'moonshot/kimi-k2',
    })

    expect(
      resolveOpenClawProvider({
        providerType: 'google',
        apiKey: 'google-key',
        modelId: 'gemini-2.5-pro',
      }),
    ).toEqual({
      envValues: {},
    })

    expect(
      resolveOpenClawProvider({
        providerType: 'custom-api-key',
        baseUrl: 'https://example.test/v1',
        apiKey: 'custom-key',
        modelId: 'custom-model',
      }),
    ).toEqual({
      envValues: {},
    })
  })
})
