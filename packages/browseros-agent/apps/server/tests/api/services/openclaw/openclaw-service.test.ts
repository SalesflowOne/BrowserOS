/**
 * @license
 * Copyright 2025 BrowserOS
 */

import { afterEach, describe, expect, it, mock } from 'bun:test'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { OPENCLAW_CONTAINER_HOME } from '@browseros/shared/constants/openclaw'
import {
  resolveSupportedOpenClawProvider,
  UnsupportedOpenClawProviderError,
} from '../../../../src/api/services/openclaw/openclaw-provider-map'
import {
  loadOpenClawRuntimeState,
  saveOpenClawRuntimeState,
} from '../../../../src/api/services/openclaw/openclaw-runtime-state'
import { OpenClawService } from '../../../../src/api/services/openclaw/openclaw-service'

type MutableOpenClawService = OpenClawService & {
  openclawDir: string
  token: string
  restart: ReturnType<typeof mock>
  repairRuntime: ReturnType<typeof mock>
  resetRuntime: ReturnType<typeof mock>
  controlPlaneStatus:
    | 'connected'
    | 'connecting'
    | 'reconnecting'
    | 'recovering'
    | 'failed'
    | 'disconnected'
  lastError: string | null
  lastGatewayError: string | null
  lastRecoveryReason:
    | 'token_mismatch'
    | 'container_not_ready'
    | 'unknown'
    | null
  runtime: {
    ensureReady?: (_onLog?: (_line: string) => void) => Promise<void>
    isPodmanAvailable?: () => Promise<boolean>
    getMachineStatus?: () => Promise<{ initialized: boolean; running: boolean }>
    inspectGateway?: () => Promise<{
      exists: boolean
      running: boolean
      hostPort: number | null
    }>
    isReady: (_port: number) => Promise<boolean>
    pullImage?: (
      _image: string,
      _onLog?: (_line: string) => void,
    ) => Promise<void>
    startGateway?: (
      _input: unknown,
      _onLog?: (_line: string) => void,
    ) => Promise<number>
    restartGateway?: (
      _input: unknown,
      _onLog?: (_line: string) => void,
    ) => Promise<number>
    stopGateway?: (_onLog?: (_line: string) => void) => Promise<void>
    getGatewayLogs?: (_tail?: number) => Promise<string[]>
    tailGatewayLogs?: (_onLog?: (_line: string) => void) => () => void
    waitForReady?: (_port: number, _timeoutMs: number) => Promise<boolean>
    stopMachineIfSafe?: () => Promise<void>
  }
  cliClient: {
    probe?: ReturnType<typeof mock>
    createAgent?: ReturnType<typeof mock>
    getConfig?: ReturnType<typeof mock>
    listAgents?: ReturnType<typeof mock>
    setDefaultModel?: ReturnType<typeof mock>
  }
  bootstrapCliClient: {
    runOnboard?: ReturnType<typeof mock>
    setConfigBatch?: ReturnType<typeof mock>
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

  it('creates agents through the cli client without role bootstrap files', async () => {
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
    })

    expect(createAgent).toHaveBeenCalledWith({
      name: 'ops',
      model: undefined,
    })
    expect(agent).toEqual({
      agentId: 'ops',
      name: 'ops',
      workspace: `${OPENCLAW_CONTAINER_HOME}/workspace-ops`,
      model: 'openclaw/default',
    })
    expect(
      existsSync(
        join(tempDir, '.openclaw', 'workspace-ops', '.browseros-role.json'),
      ),
    ).toBe(false)
  })

  it('lists plain agent entries without role metadata', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'openclaw-service-'))
    await mkdir(join(tempDir, '.openclaw', 'workspace-ops'), {
      recursive: true,
    })
    await writeFile(join(tempDir, '.openclaw', 'openclaw.json'), '{}')
    await writeFile(
      join(tempDir, '.openclaw', 'workspace-ops', '.browseros-role.json'),
      '{"roleId":"chief-of-staff"}\n',
      'utf-8',
    )
    const service = new OpenClawService() as MutableOpenClawService

    service.openclawDir = tempDir
    service.runtime = {
      isReady: async () => true,
    }
    service.cliClient = {
      getConfig: mock(async () => 'cli-token'),
      listAgents: mock(async () => [
        {
          agentId: 'ops',
          name: 'ops',
          workspace: `${OPENCLAW_CONTAINER_HOME}/workspace-ops`,
          model: 'openai/gpt-5.4-mini',
        },
      ]),
    }

    await expect(service.listAgents()).resolves.toEqual([
      {
        agentId: 'ops',
        name: 'ops',
        workspace: `${OPENCLAW_CONTAINER_HOME}/workspace-ops`,
        model: 'openai/gpt-5.4-mini',
      },
    ])
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
      inspectGateway: async () => ({
        exists: true,
        running: true,
        hostPort: 52345,
      }),
      isReady: async (_port: number) => true,
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
      port: 52345,
      agentCount: 2,
      error: null,
      controlPlaneStatus: 'connected',
      lastGatewayError: null,
      lastRecoveryReason: null,
    })
    const runtimeState = await loadOpenClawRuntimeState(tempDir)
    expect(runtimeState).toMatchObject({
      hostGatewayPort: 52345,
      repairGeneration: 0,
      lastRepairOutcome: null,
    })
  })

  it('preserves the persisted gateway port when Podman is unavailable', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'openclaw-service-'))
    await saveOpenClawRuntimeState(tempDir, {
      hostGatewayPort: 44321,
      lastSuccessfulStartAt: '2026-04-20T18:00:00.000Z',
      repairGeneration: 1,
      lastRepairOutcome: 'success',
    })
    const service = new OpenClawService() as MutableOpenClawService

    service.openclawDir = tempDir
    service.runtime = {
      isPodmanAvailable: async () => false,
    }

    await expect(service.getStatus()).resolves.toMatchObject({
      status: 'uninitialized',
      podmanAvailable: false,
      machineReady: false,
      port: 44321,
      agentCount: 0,
      error: null,
      controlPlaneStatus: 'disconnected',
      lastGatewayError: null,
      lastRecoveryReason: null,
    })
  })

  it('reports error status when gateway failure state is present', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'openclaw-service-'))
    await mkdir(join(tempDir, '.openclaw'), { recursive: true })
    await writeFile(join(tempDir, '.openclaw', 'openclaw.json'), '{}')
    await saveOpenClawRuntimeState(tempDir, {
      hostGatewayPort: 45555,
      lastSuccessfulStartAt: '2026-04-20T18:00:00.000Z',
      repairGeneration: 2,
      lastRepairOutcome: 'success',
    })
    const service = new OpenClawService() as MutableOpenClawService

    service.openclawDir = tempDir
    service.controlPlaneStatus = 'failed'
    service.lastGatewayError = 'OpenClaw gateway is not ready'
    service.runtime = {
      isPodmanAvailable: async () => true,
      getMachineStatus: async () => ({ initialized: true, running: false }),
      inspectGateway: async () => ({
        exists: true,
        running: false,
        hostPort: 45555,
      }),
      isReady: async (_port: number) => false,
    }

    await expect(service.getStatus()).resolves.toMatchObject({
      status: 'error',
      podmanAvailable: true,
      machineReady: false,
      port: 45555,
      agentCount: 0,
      error: null,
      controlPlaneStatus: 'failed',
      lastGatewayError: 'OpenClaw gateway is not ready',
      lastRecoveryReason: null,
    })
  })

  it('creates the main agent during setup when the gateway starts without one', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'openclaw-service-'))
    const steps: string[] = []
    const runOnboard = mock(async () => {
      steps.push('onboard')
    })
    const setConfigBatch = mock(async () => {
      steps.push('batch')
    })
    const setDefaultModel = mock(async () => {})
    const validateConfig = mock(async () => {
      steps.push('validate')
      return { ok: true }
    })
    const createAgent = mock(async () => ({
      agentId: 'main',
      name: 'main',
      workspace: `${OPENCLAW_CONTAINER_HOME}/workspace`,
    }))
    const service = new OpenClawService() as MutableOpenClawService

    service.openclawDir = tempDir
    const pullImage = mock(async () => {
      steps.push('pull')
    })
    const restartGateway = mock(async () => {
      steps.push('restart')
      return 18789
    })
    const startGateway = mock(async () => {
      steps.push('start')
      return 31234
    })
    service.runtime = {
      isPodmanAvailable: async () => true,
      ensureReady: async () => {},
      isReady: async () => true,
      pullImage,
      restartGateway,
      startGateway,
      waitForReady: mock(async (port: number) => {
        steps.push('ready')
        expect(port).toBe(31234)
        return true
      }),
    }
    service.cliClient = {
      probe: mock(async () => {}),
      listAgents: mock(async () => []),
      createAgent,
    }
    service.bootstrapCliClient = {
      runOnboard,
      setConfigBatch,
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
      installDaemon: false,
      mode: 'local',
      nonInteractive: true,
      skipHealth: true,
    })
    expect(setConfigBatch).toHaveBeenCalledWith(
      expect.arrayContaining([
        {
          path: 'mcp.servers.browseros.url',
          value: 'http://host.containers.internal:9100/mcp',
        },
        {
          path: 'mcp.servers.browseros.transport',
          value: 'streamable-http',
        },
        {
          path: 'gateway.http.endpoints.chatCompletions.enabled',
          value: true,
        },
      ]),
    )
    expect(validateConfig).toHaveBeenCalled()
    expect(createAgent).toHaveBeenCalledWith({
      name: 'main',
      model: undefined,
    })
    expect(steps).toEqual([
      'pull',
      'onboard',
      'batch',
      'validate',
      'start',
      'ready',
    ])
    expect(pullImage).toHaveBeenCalledWith(
      'ghcr.io/openclaw/openclaw:2026.4.12',
      expect.any(Function),
    )
    expect(startGateway).toHaveBeenCalledWith(
      expect.objectContaining({
        image: 'ghcr.io/openclaw/openclaw:2026.4.12',
        port: 18789,
        hostHome: tempDir,
        envFilePath: join(tempDir, '.openclaw', '.env'),
        gatewayToken: undefined,
      }),
      expect.any(Function),
    )
    expect(restartGateway).not.toHaveBeenCalled()
    const runtimeState = await loadOpenClawRuntimeState(tempDir)
    expect(runtimeState).toMatchObject({
      hostGatewayPort: 31234,
      repairGeneration: 0,
      lastRepairOutcome: null,
    })
    expect(runtimeState?.lastSuccessfulStartAt).not.toBeNull()
  })

  it('applies setup-time config in one batch before the gateway starts', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'openclaw-service-'))
    const runOnboard = mock(async () => {})
    const setConfigBatch = mock(async () => {})
    const validateConfig = mock(async () => ({ ok: true }))
    const createAgent = mock(async () => ({
      agentId: 'main',
      name: 'main',
      workspace: `${OPENCLAW_CONTAINER_HOME}/workspace`,
    }))
    const waitForReady = mock(async (_port: number) => true)
    const service = new OpenClawService() as MutableOpenClawService

    service.openclawDir = tempDir
    const restartGateway = mock(async () => 18789)
    const startGateway = mock(async () => 31234)
    service.runtime = {
      isPodmanAvailable: async () => true,
      ensureReady: async () => {},
      isReady: async () => true,
      pullImage: async () => {},
      restartGateway,
      startGateway,
      waitForReady,
    }
    service.cliClient = {
      probe: mock(async () => {}),
      listAgents: mock(async () => []),
      createAgent,
    }
    service.bootstrapCliClient = {
      runOnboard,
      setConfigBatch,
      setDefaultModel: mock(async () => {}),
      validateConfig,
    }

    await expect(service.setup({})).resolves.toBeUndefined()

    expect(setConfigBatch).toHaveBeenCalledTimes(1)
    expect(waitForReady).toHaveBeenCalledTimes(1)
    expect(createAgent).toHaveBeenCalledWith({
      name: 'main',
      model: undefined,
    })
    expect(startGateway).toHaveBeenCalledTimes(1)
    expect(restartGateway).not.toHaveBeenCalled()
  })

  it('loads the persisted gateway token from the mounted config before control plane calls', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'openclaw-service-'))
    await mkdir(join(tempDir, '.openclaw'), { recursive: true })
    await writeFile(
      join(tempDir, '.openclaw', 'openclaw.json'),
      JSON.stringify({
        gateway: {
          auth: {
            token: 'cli-token',
          },
        },
      }),
    )
    const service = new OpenClawService() as MutableOpenClawService

    service.openclawDir = tempDir
    service.token = 'random-token'
    service.runtime = {
      isReady: async () => true,
    }
    service.cliClient = {
      listAgents: mock(async () => {
        expect(service.token).toBe('cli-token')
        return []
      }),
    }

    await service.listAgents()
  })

  it('caches the loaded gateway token from config across steady-state control plane calls', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'openclaw-service-'))
    await mkdir(join(tempDir, '.openclaw'), { recursive: true })
    await writeFile(
      join(tempDir, '.openclaw', 'openclaw.json'),
      JSON.stringify({
        gateway: {
          auth: {
            token: 'cli-token',
          },
        },
      }),
    )
    const listAgents = mock(async () => [])
    const service = new OpenClawService() as MutableOpenClawService

    service.openclawDir = tempDir
    service.runtime = {
      isReady: async () => true,
    }
    service.cliClient = {
      listAgents,
    }

    await service.listAgents()
    await service.listAgents()

    expect(listAgents).toHaveBeenCalledTimes(2)
  })

  it('writes provider credentials into the mounted state env file during setup', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'openclaw-service-'))
    const service = new OpenClawService() as MutableOpenClawService

    service.openclawDir = tempDir
    service.runtime = {
      isPodmanAvailable: async () => true,
      ensureReady: async () => {},
      isReady: async () => true,
      pullImage: async () => {},
      restartGateway: async () => 18789,
      startGateway: async () => 31234,
      waitForReady: async (_port: number) => true,
    }
    service.cliClient = {
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
    service.bootstrapCliClient = {
      runOnboard: mock(async () => {}),
      setConfigBatch: mock(async () => {}),
      setDefaultModel: mock(async () => {}),
      validateConfig: mock(async () => ({ ok: true })),
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

  it('merges custom openai-compatible providers into config during setup', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'openclaw-service-'))
    const openclawTempDir = tempDir
    const runOnboard = mock(async () => {
      await mkdir(join(openclawTempDir, '.openclaw'), { recursive: true })
      await writeFile(
        join(openclawTempDir, '.openclaw', 'openclaw.json'),
        JSON.stringify({
          gateway: {
            auth: {
              token: 'cli-token',
            },
          },
        }),
        'utf-8',
      )
    })
    const setConfigBatch = mock(async () => {})
    const setDefaultModel = mock(async () => {})
    const validateConfig = mock(async () => ({ ok: true }))
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
      pullImage: async () => {},
      restartGateway: async () => 18789,
      startGateway: async () => 31234,
      waitForReady: async (_port: number) => true,
    }
    service.cliClient = {
      probe: mock(async () => {}),
      listAgents: mock(async () => []),
      createAgent,
    }
    service.bootstrapCliClient = {
      runOnboard,
      setConfigBatch,
      setDefaultModel,
      validateConfig,
    }

    await service.setup({
      providerType: 'openai-compatible',
      providerName: 'Kimi K2.5',
      baseUrl: 'https://api.fireworks.ai/inference/v1',
      apiKey: 'custom-key',
      modelId: 'accounts/fireworks/models/kimi-k2p5',
    })

    expect(setDefaultModel).toHaveBeenCalledWith(
      'kimi-k2-5/accounts/fireworks/models/kimi-k2p5',
    )
    expect(
      await readFile(join(tempDir, '.openclaw', '.env'), 'utf-8'),
    ).toContain('KIMI_K2_5_API_KEY=custom-key')
    expect(
      JSON.parse(
        await readFile(join(tempDir, '.openclaw', 'openclaw.json'), 'utf-8'),
      ),
    ).toMatchObject({
      gateway: {
        auth: {
          token: 'cli-token',
        },
      },
      models: {
        mode: 'merge',
        providers: {
          'kimi-k2-5': {
            api: 'openai-completions',
            baseUrl: 'https://api.fireworks.ai/inference/v1',
            apiKey: `\${KIMI_K2_5_API_KEY}`,
            models: [
              {
                id: 'accounts/fireworks/models/kimi-k2p5',
                name: 'accounts/fireworks/models/kimi-k2p5',
              },
            ],
          },
        },
      },
    })
  })

  it('start uses the direct runtime startGateway flow', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'openclaw-service-'))
    await mkdir(join(tempDir, '.openclaw'), { recursive: true })
    await writeFile(
      join(tempDir, '.openclaw', 'openclaw.json'),
      JSON.stringify({
        gateway: {
          auth: {
            token: 'cli-token',
          },
        },
      }),
    )
    await saveOpenClawRuntimeState(tempDir, {
      hostGatewayPort: 41234,
      lastSuccessfulStartAt: '2026-04-20T18:00:00.000Z',
      repairGeneration: 2,
      lastRepairOutcome: 'success',
    })
    const ensureReady = mock(async () => {})
    const startGateway = mock(async () => 51234)
    const waitForReady = mock(async (port: number) => {
      expect(port).toBe(51234)
      return true
    })
    const probe = mock(async () => {})
    const service = new OpenClawService() as MutableOpenClawService

    service.openclawDir = tempDir
    service.runtime = {
      ensureReady,
      isReady: async () => true,
      startGateway,
      waitForReady,
    }
    service.cliClient = {
      probe,
    }

    await service.start()

    expect(ensureReady).toHaveBeenCalledTimes(1)
    expect(startGateway).toHaveBeenCalledWith(
      expect.objectContaining({
        image: 'ghcr.io/openclaw/openclaw:2026.4.12',
        port: 41234,
        hostHome: tempDir,
        envFilePath: join(tempDir, '.openclaw', '.env'),
        gatewayToken: 'cli-token',
      }),
      expect.any(Function),
    )
    expect(waitForReady).toHaveBeenCalledTimes(1)
    expect(probe).toHaveBeenCalledTimes(1)
    const runtimeState = await loadOpenClawRuntimeState(tempDir)
    expect(runtimeState).toMatchObject({
      hostGatewayPort: 51234,
      repairGeneration: 2,
      lastRepairOutcome: null,
    })
  })

  it('does not persist a successful start until readiness and probe succeed', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'openclaw-service-'))
    await mkdir(join(tempDir, '.openclaw'), { recursive: true })
    await writeFile(
      join(tempDir, '.openclaw', 'openclaw.json'),
      JSON.stringify({
        gateway: {
          auth: {
            token: 'cli-token',
          },
        },
      }),
    )
    await saveOpenClawRuntimeState(tempDir, {
      hostGatewayPort: 41234,
      lastSuccessfulStartAt: '2026-04-20T18:00:00.000Z',
      repairGeneration: 2,
      lastRepairOutcome: 'success',
    })
    const stopLogTail = mock(() => {})
    const tailGatewayLogs = mock(() => stopLogTail)
    const startGateway = mock(async () => 51234)
    const waitForReady = mock(async () => false)
    const service = new OpenClawService() as MutableOpenClawService
    const previousNodeEnv = process.env.NODE_ENV

    process.env.NODE_ENV = 'development'
    service.openclawDir = tempDir
    service.runtime = {
      ensureReady: async () => {},
      isReady: async () => true,
      startGateway,
      tailGatewayLogs,
      waitForReady,
    }
    service.cliClient = {
      probe: mock(async () => {
        throw new Error('probe should not run when readiness fails')
      }),
    }

    try {
      await expect(service.start()).rejects.toThrow(
        'Gateway did not become ready after start',
      )
    } finally {
      process.env.NODE_ENV = previousNodeEnv
    }

    expect(tailGatewayLogs).toHaveBeenCalledTimes(1)
    expect(stopLogTail).toHaveBeenCalledTimes(1)
    expect(waitForReady).toHaveBeenCalledWith(51234, expect.any(Number))
    expect(startGateway).toHaveBeenCalledTimes(1)
    await expect(loadOpenClawRuntimeState(tempDir)).resolves.toMatchObject({
      hostGatewayPort: 41234,
      lastSuccessfulStartAt: '2026-04-20T18:00:00.000Z',
      repairGeneration: 2,
      lastRepairOutcome: 'success',
    })
  })

  it('restart uses the direct runtime restartGateway flow', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'openclaw-service-'))
    await mkdir(join(tempDir, '.openclaw'), { recursive: true })
    await writeFile(
      join(tempDir, '.openclaw', 'openclaw.json'),
      JSON.stringify({
        gateway: {
          auth: {
            token: 'cli-token',
          },
        },
      }),
    )
    await saveOpenClawRuntimeState(tempDir, {
      hostGatewayPort: 51234,
      lastSuccessfulStartAt: '2026-04-20T18:00:00.000Z',
      repairGeneration: 3,
      lastRepairOutcome: 'success',
    })
    const restartGateway = mock(async () => 61234)
    const waitForReady = mock(async (port: number) => {
      expect(port).toBe(61234)
      return true
    })
    const probe = mock(async () => {})
    const service = new OpenClawService() as MutableOpenClawService

    service.openclawDir = tempDir
    service.runtime = {
      isReady: async () => true,
      restartGateway,
      waitForReady,
    }
    service.cliClient = {
      probe,
    }

    await service.restart()

    expect(restartGateway).toHaveBeenCalledWith(
      expect.objectContaining({
        image: 'ghcr.io/openclaw/openclaw:2026.4.12',
        port: 51234,
        hostHome: tempDir,
        envFilePath: join(tempDir, '.openclaw', '.env'),
        gatewayToken: 'cli-token',
      }),
      expect.any(Function),
    )
    expect(waitForReady).toHaveBeenCalledTimes(1)
    expect(probe).toHaveBeenCalledTimes(1)
    const runtimeState = await loadOpenClawRuntimeState(tempDir)
    expect(runtimeState).toMatchObject({
      hostGatewayPort: 61234,
      repairGeneration: 3,
      lastRepairOutcome: null,
    })
  })

  it('clears stale lastError after reconnecting the control plane', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'openclaw-service-'))
    await mkdir(join(tempDir, '.openclaw'), { recursive: true })
    await writeFile(join(tempDir, '.openclaw', 'openclaw.json'), '{}')
    await saveOpenClawRuntimeState(tempDir, {
      hostGatewayPort: 54545,
      lastSuccessfulStartAt: '2026-04-20T18:00:00.000Z',
      repairGeneration: 1,
      lastRepairOutcome: 'success',
    })
    const probe = mock(async () => {})
    const service = new OpenClawService() as MutableOpenClawService

    service.openclawDir = tempDir
    service.controlPlaneStatus = 'failed'
    service.lastError = 'stale reconnect failure'
    service.lastGatewayError = 'stale gateway failure'
    service.lastRecoveryReason = 'unknown'
    service.runtime = {
      isPodmanAvailable: async () => true,
      getMachineStatus: async () => ({ initialized: true, running: true }),
      inspectGateway: async () => ({
        exists: true,
        running: true,
        hostPort: 54545,
      }),
      isReady: async (_port: number) => true,
    }
    service.cliClient = {
      probe,
      listAgents: mock(async () => []),
    }

    await service.reconnectControlPlane()

    await expect(service.getStatus()).resolves.toMatchObject({
      status: 'running',
      error: null,
      controlPlaneStatus: 'connected',
      lastGatewayError: null,
      lastRecoveryReason: null,
    })
    expect(probe).toHaveBeenCalledTimes(1)
  })

  it('escalates restart failures with machine corruption signatures into repair', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'openclaw-service-'))
    await mkdir(join(tempDir, '.openclaw'), { recursive: true })
    await writeFile(
      join(tempDir, '.openclaw', 'openclaw.json'),
      JSON.stringify({
        gateway: {
          auth: {
            token: 'cli-token',
          },
        },
      }),
    )
    await saveOpenClawRuntimeState(tempDir, {
      hostGatewayPort: 63234,
      lastSuccessfulStartAt: '2026-04-20T18:00:00.000Z',
      repairGeneration: 4,
      lastRepairOutcome: 'success',
    })
    const restartGateway = mock(async () => {
      throw new Error(
        'podman machine start failed: machine is corrupted and needs to be removed',
      )
    })
    const stopGateway = mock(async () => {})
    const stopMachineIfSafe = mock(async () => {})
    const ensureReady = mock(async () => {})
    const startGateway = mock(async () => 71234)
    const waitForReady = mock(async (port: number) => {
      expect(port).toBe(71234)
      return true
    })
    const probe = mock(async () => {})
    const service = new OpenClawService() as MutableOpenClawService

    service.openclawDir = tempDir
    service.runtime = {
      ensureReady,
      isReady: async () => true,
      restartGateway,
      startGateway,
      stopGateway,
      stopMachineIfSafe,
      waitForReady,
    }
    service.cliClient = {
      probe,
    }

    await service.restart()

    expect(restartGateway).toHaveBeenCalledTimes(1)
    expect(stopGateway).toHaveBeenCalledTimes(1)
    expect(stopMachineIfSafe).toHaveBeenCalledTimes(1)
    expect(ensureReady).toHaveBeenCalledTimes(1)
    expect(startGateway).toHaveBeenCalledWith(
      expect.objectContaining({
        image: 'ghcr.io/openclaw/openclaw:2026.4.12',
        port: 63234,
        hostHome: tempDir,
        envFilePath: join(tempDir, '.openclaw', '.env'),
        gatewayToken: 'cli-token',
      }),
      expect.any(Function),
    )
    expect(waitForReady).toHaveBeenCalledWith(71234, expect.any(Number))
    expect(probe).toHaveBeenCalledTimes(1)
    expect(
      JSON.parse(await readFile(join(tempDir, 'runtime-state.json'), 'utf-8')),
    ).toMatchObject({
      hostGatewayPort: 71234,
      repairGeneration: 5,
      lastRepairOutcome: 'success',
    })
  })

  it('resets runtime state and clears the persisted host port', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'openclaw-service-'))
    await mkdir(join(tempDir, '.openclaw'), { recursive: true })
    await writeFile(join(tempDir, '.openclaw', 'openclaw.json'), '{}')
    await saveOpenClawRuntimeState(tempDir, {
      hostGatewayPort: 73234,
      lastSuccessfulStartAt: '2026-04-20T18:00:00.000Z',
      repairGeneration: 9,
      lastRepairOutcome: 'failed',
    })
    const stopGateway = mock(async () => {})
    const stopMachineIfSafe = mock(async () => {})
    const service = new OpenClawService() as MutableOpenClawService

    service.openclawDir = tempDir
    service.runtime = {
      isPodmanAvailable: async () => true,
      getMachineStatus: async () => ({ initialized: true, running: false }),
      inspectGateway: async () => ({
        exists: false,
        running: false,
        hostPort: null,
      }),
      isReady: async (_port: number) => false,
      stopGateway,
      stopMachineIfSafe,
    }

    await service.resetRuntime()

    expect(stopGateway).toHaveBeenCalledTimes(1)
    expect(stopMachineIfSafe).toHaveBeenCalledTimes(1)
    await expect(loadOpenClawRuntimeState(tempDir)).resolves.toEqual({
      hostGatewayPort: null,
      lastSuccessfulStartAt: null,
      repairGeneration: 0,
      lastRepairOutcome: null,
    })
    await expect(service.getStatus()).resolves.toMatchObject({
      port: null,
      status: 'stopped',
    })
  })

  it('stop calls runtime.stopGateway', async () => {
    const stopGateway = mock(async () => {})
    const service = new OpenClawService() as MutableOpenClawService

    service.runtime = {
      isReady: async () => true,
      stopGateway,
    }

    await service.stop()

    expect(stopGateway).toHaveBeenCalledTimes(1)
  })

  it('getLogs proxies to runtime.getGatewayLogs with tail', async () => {
    const getGatewayLogs = mock(async (tail = 50) => [`tail:${tail}`])
    const service = new OpenClawService() as MutableOpenClawService

    service.runtime = {
      isReady: async () => true,
      getGatewayLogs,
    }

    await expect(service.getLogs(25)).resolves.toEqual(['tail:25'])
    expect(getGatewayLogs).toHaveBeenCalledWith(25)
  })

  it('shutdown stops gateway and then stops machine when safe', async () => {
    const stopGateway = mock(async () => {})
    const stopMachineIfSafe = mock(async () => {})
    const service = new OpenClawService() as MutableOpenClawService

    service.runtime = {
      isReady: async () => true,
      stopGateway,
      stopMachineIfSafe,
    }

    await service.shutdown()

    expect(stopGateway).toHaveBeenCalledTimes(1)
    expect(stopMachineIfSafe).toHaveBeenCalledTimes(1)
  })

  it('shutdown still stops machine when stopGateway fails', async () => {
    const stopGateway = mock(async () => {
      throw new Error('stop failed')
    })
    const stopMachineIfSafe = mock(async () => {})
    const service = new OpenClawService() as MutableOpenClawService

    service.runtime = {
      isReady: async () => true,
      stopGateway,
      stopMachineIfSafe,
    }

    await expect(service.shutdown()).resolves.toBeUndefined()

    expect(stopGateway).toHaveBeenCalledTimes(1)
    expect(stopMachineIfSafe).toHaveBeenCalledTimes(1)
  })

  it('tryAutoStart uses direct-runtime startGateway when gateway is not ready', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'openclaw-service-'))
    await mkdir(join(tempDir, '.openclaw'), { recursive: true })
    await writeFile(
      join(tempDir, '.openclaw', 'openclaw.json'),
      JSON.stringify({
        gateway: {
          auth: {
            token: 'cli-token',
          },
        },
      }),
    )
    const ensureReady = mock(async () => {})
    const isReady = mock(async () => false)
    const startGateway = mock(async () => 61234)
    const waitForReady = mock(async (port: number) => {
      expect(port).toBe(61234)
      return true
    })
    const probe = mock(async () => {})
    const service = new OpenClawService() as MutableOpenClawService

    service.openclawDir = tempDir
    service.runtime = {
      isPodmanAvailable: async () => true,
      ensureReady,
      isReady,
      startGateway,
      waitForReady,
    }
    service.cliClient = {
      probe,
    }

    await service.tryAutoStart()

    expect(ensureReady).toHaveBeenCalledTimes(1)
    expect(startGateway).toHaveBeenCalledWith(
      expect.objectContaining({
        image: 'ghcr.io/openclaw/openclaw:2026.4.12',
        port: 18789,
        hostHome: tempDir,
        envFilePath: join(tempDir, '.openclaw', '.env'),
        gatewayToken: 'cli-token',
      }),
    )
    expect(waitForReady).toHaveBeenCalledTimes(1)
    expect(probe).toHaveBeenCalledTimes(2)
    expect(isReady).toHaveBeenCalledTimes(1)
  })

  it('keeps openrouter model refs verbatim without rewriting dots', () => {
    const provider = resolveSupportedOpenClawProvider({
      providerType: 'openrouter',
      apiKey: 'or-key',
      modelId: 'anthropic/claude-haiku-4.5',
    })

    expect(provider).toEqual({
      envValues: {
        OPENROUTER_API_KEY: 'or-key',
      },
      model: 'openrouter/anthropic/claude-haiku-4.5',
      providerType: 'openrouter',
    })
  })

  it('resolves builtin and custom providers into OpenClaw config inputs', () => {
    expect(
      resolveSupportedOpenClawProvider({
        providerType: 'anthropic',
        apiKey: 'ant-key',
        modelId: 'claude-sonnet-4.5',
      }),
    ).toEqual({
      envValues: {
        ANTHROPIC_API_KEY: 'ant-key',
      },
      model: 'anthropic/claude-sonnet-4.5',
      providerType: 'anthropic',
    })

    expect(
      resolveSupportedOpenClawProvider({
        providerType: 'moonshot',
        apiKey: 'moon-key',
        modelId: 'kimi-k2',
      }),
    ).toEqual({
      envValues: {
        MOONSHOT_API_KEY: 'moon-key',
      },
      model: 'moonshot/kimi-k2',
      providerType: 'moonshot',
    })

    expect(
      resolveSupportedOpenClawProvider({
        providerType: 'openai-compatible',
        providerName: 'Kimi K2.5',
        baseUrl: 'https://api.fireworks.ai/inference/v1',
        apiKey: 'custom-key',
        modelId: 'accounts/fireworks/models/kimi-k2p5',
      }),
    ).toEqual({
      envValues: {
        KIMI_K2_5_API_KEY: 'custom-key',
      },
      model: 'kimi-k2-5/accounts/fireworks/models/kimi-k2p5',
      customProvider: {
        providerId: 'kimi-k2-5',
        apiKeyEnvVar: 'KIMI_K2_5_API_KEY',
        config: {
          api: 'openai-completions',
          baseUrl: 'https://api.fireworks.ai/inference/v1',
          apiKey: `\${KIMI_K2_5_API_KEY}`,
          models: [
            {
              id: 'accounts/fireworks/models/kimi-k2p5',
              name: 'accounts/fireworks/models/kimi-k2p5',
            },
          ],
        },
      },
    })

    expect(() =>
      resolveSupportedOpenClawProvider({
        providerType: 'google',
        apiKey: 'google-key',
        modelId: 'gemini-2.5-pro',
      }),
    ).toThrow(new UnsupportedOpenClawProviderError('google'))
  })

  it('rejects unsupported providers before mutating env or creating agents', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'openclaw-service-'))
    const createAgent = mock(async () => ({
      agentId: 'ops',
      name: 'ops',
      workspace: `${OPENCLAW_CONTAINER_HOME}/workspace-ops`,
    }))
    const restart = mock(async () => {})
    const service = new OpenClawService() as MutableOpenClawService

    service.openclawDir = tempDir
    service.restart = restart
    service.runtime = {
      isReady: async () => true,
    }
    service.cliClient = {
      createAgent,
    }

    await expect(
      service.createAgent({
        name: 'ops',
        providerType: 'google',
        apiKey: 'google-key',
        modelId: 'gemini-2.5-pro',
      }),
    ).rejects.toThrow('Unsupported OpenClaw provider')

    expect(createAgent).not.toHaveBeenCalled()
    expect(restart).not.toHaveBeenCalled()
    expect(existsSync(join(tempDir, '.openclaw', '.env'))).toBe(false)
  })

  it('passes openrouter model refs through verbatim into agent creation', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'openclaw-service-'))
    await mkdir(join(tempDir, '.openclaw'), { recursive: true })
    await writeFile(
      join(tempDir, '.openclaw', '.env'),
      'OPENROUTER_API_KEY=or-key\n',
      'utf-8',
    )
    const createAgent = mock(async () => ({
      agentId: 'research',
      name: 'research',
      workspace: `${OPENCLAW_CONTAINER_HOME}/workspace-research`,
      model: 'openrouter/anthropic/claude-haiku-4.5',
    }))
    const restart = mock(async () => {})
    const service = new OpenClawService() as MutableOpenClawService

    service.openclawDir = tempDir
    service.restart = restart
    service.runtime = {
      isReady: async () => true,
    }
    service.cliClient = {
      createAgent,
    }

    await service.createAgent({
      name: 'research',
      providerType: 'openrouter',
      apiKey: 'or-key',
      modelId: 'anthropic/claude-haiku-4.5',
    })

    expect(createAgent).toHaveBeenCalledWith({
      name: 'research',
      model: 'openrouter/anthropic/claude-haiku-4.5',
    })
    expect(restart).not.toHaveBeenCalled()
  })

  it('merges custom openai-compatible providers before creating agents', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'openclaw-service-'))
    await mkdir(join(tempDir, '.openclaw'), { recursive: true })
    await writeFile(
      join(tempDir, '.openclaw', 'openclaw.json'),
      JSON.stringify({
        gateway: {
          auth: {
            token: 'cli-token',
          },
        },
      }),
      'utf-8',
    )
    await writeFile(join(tempDir, '.openclaw', '.env'), '', 'utf-8')

    const createAgent = mock(async () => ({
      agentId: 'research',
      name: 'research',
      workspace: `${OPENCLAW_CONTAINER_HOME}/workspace-research`,
      model: 'kimi-k2-5/accounts/fireworks/models/kimi-k2p5',
    }))
    const restart = mock(async () => {})
    const service = new OpenClawService() as MutableOpenClawService

    service.openclawDir = tempDir
    service.restart = restart
    service.runtime = {
      isReady: async () => true,
    }
    service.cliClient = {
      createAgent,
    }

    await service.createAgent({
      name: 'research',
      providerType: 'openai-compatible',
      providerName: 'Kimi K2.5',
      baseUrl: 'https://api.fireworks.ai/inference/v1',
      apiKey: 'custom-key',
      modelId: 'accounts/fireworks/models/kimi-k2p5',
    })

    expect(restart).toHaveBeenCalledTimes(1)
    expect(createAgent).toHaveBeenCalledWith({
      name: 'research',
      model: 'kimi-k2-5/accounts/fireworks/models/kimi-k2p5',
    })
    expect(
      await readFile(join(tempDir, '.openclaw', '.env'), 'utf-8'),
    ).toContain('KIMI_K2_5_API_KEY=custom-key')
    expect(
      JSON.parse(
        await readFile(join(tempDir, '.openclaw', 'openclaw.json'), 'utf-8'),
      ),
    ).toMatchObject({
      gateway: {
        auth: {
          token: 'cli-token',
        },
      },
      models: {
        mode: 'merge',
        providers: {
          'kimi-k2-5': {
            api: 'openai-completions',
            baseUrl: 'https://api.fireworks.ai/inference/v1',
            apiKey: `\${KIMI_K2_5_API_KEY}`,
            models: [
              {
                id: 'accounts/fireworks/models/kimi-k2p5',
                name: 'accounts/fireworks/models/kimi-k2p5',
              },
            ],
          },
        },
      },
    })
  })

  it('preserves previously-registered custom provider models when re-registering an existing model', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'openclaw-service-'))
    await mkdir(join(tempDir, '.openclaw'), { recursive: true })
    await writeFile(
      join(tempDir, '.openclaw', 'openclaw.json'),
      JSON.stringify({
        gateway: {
          auth: {
            token: 'cli-token',
          },
        },
        models: {
          mode: 'merge',
          providers: {
            'kimi-k2-5': {
              api: 'openai-completions',
              baseUrl: 'https://api.fireworks.ai/inference/v1',
              apiKey: `\${KIMI_K2_5_API_KEY}`,
              models: [
                {
                  id: 'accounts/fireworks/models/kimi-k2p5',
                  name: 'accounts/fireworks/models/kimi-k2p5',
                },
                {
                  id: 'accounts/fireworks/models/kimi-k2p5-thinking',
                  name: 'accounts/fireworks/models/kimi-k2p5-thinking',
                },
              ],
            },
          },
        },
      }),
      'utf-8',
    )
    await writeFile(join(tempDir, '.openclaw', '.env'), '', 'utf-8')

    const createAgent = mock(async () => ({
      agentId: 'research',
      name: 'research',
      workspace: `${OPENCLAW_CONTAINER_HOME}/workspace-research`,
      model: 'kimi-k2-5/accounts/fireworks/models/kimi-k2p5',
    }))
    const restart = mock(async () => {})
    const service = new OpenClawService() as MutableOpenClawService

    service.openclawDir = tempDir
    service.restart = restart
    service.runtime = {
      isReady: async () => true,
    }
    service.cliClient = {
      createAgent,
    }

    await service.createAgent({
      name: 'research',
      providerType: 'openai-compatible',
      providerName: 'Kimi K2.5',
      baseUrl: 'https://api.fireworks.ai/inference/v1',
      apiKey: 'custom-key',
      modelId: 'accounts/fireworks/models/kimi-k2p5',
    })

    expect(
      JSON.parse(
        await readFile(join(tempDir, '.openclaw', 'openclaw.json'), 'utf-8'),
      ),
    ).toMatchObject({
      models: {
        mode: 'merge',
        providers: {
          'kimi-k2-5': {
            models: [
              {
                id: 'accounts/fireworks/models/kimi-k2p5',
                name: 'accounts/fireworks/models/kimi-k2p5',
              },
              {
                id: 'accounts/fireworks/models/kimi-k2p5-thinking',
                name: 'accounts/fireworks/models/kimi-k2p5-thinking',
              },
            ],
          },
        },
      },
    })
  })

  it('updateProviderKeys rejects unsupported providers without restarting', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'openclaw-service-'))
    const restart = mock(async () => {})
    const service = new OpenClawService() as MutableOpenClawService

    service.openclawDir = tempDir
    service.restart = restart

    await expect(
      service.updateProviderKeys({
        providerType: 'google',
        apiKey: 'google-key',
        modelId: 'gemini-2.5-pro',
      }),
    ).rejects.toThrow('Unsupported OpenClaw provider')

    expect(restart).not.toHaveBeenCalled()
  })

  it('updateProviderKeys restores custom openai-compatible providers and restarts once', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'openclaw-service-'))
    await mkdir(join(tempDir, '.openclaw'), { recursive: true })
    await writeFile(
      join(tempDir, '.openclaw', 'openclaw.json'),
      JSON.stringify({
        gateway: {
          auth: {
            token: 'cli-token',
          },
        },
      }),
      'utf-8',
    )
    await writeFile(join(tempDir, '.openclaw', '.env'), '', 'utf-8')

    const restart = mock(async () => {})
    const setDefaultModel = mock(async () => {})
    const service = new OpenClawService() as MutableOpenClawService

    service.openclawDir = tempDir
    service.restart = restart
    service.runtime = {
      isReady: async () => true,
      waitForReady: mock(async () => true),
    }
    service.cliClient = {
      setDefaultModel,
    }

    const result = await service.updateProviderKeys({
      providerType: 'openai-compatible',
      providerName: 'Kimi K2.5',
      baseUrl: 'https://api.fireworks.ai/inference/v1',
      apiKey: 'custom-key',
      modelId: 'accounts/fireworks/models/kimi-k2p5',
    })

    expect(result).toEqual({
      restarted: true,
      modelUpdated: true,
    })
    expect(restart).toHaveBeenCalledTimes(1)
    expect(setDefaultModel).toHaveBeenCalledWith(
      'kimi-k2-5/accounts/fireworks/models/kimi-k2p5',
    )
    expect(
      await readFile(join(tempDir, '.openclaw', '.env'), 'utf-8'),
    ).toContain('KIMI_K2_5_API_KEY=custom-key')
    expect(
      JSON.parse(
        await readFile(join(tempDir, '.openclaw', 'openclaw.json'), 'utf-8'),
      ),
    ).toMatchObject({
      models: {
        mode: 'merge',
        providers: {
          'kimi-k2-5': {
            api: 'openai-completions',
            baseUrl: 'https://api.fireworks.ai/inference/v1',
            apiKey: `\${KIMI_K2_5_API_KEY}`,
          },
        },
      },
    })
  })

  it('does not restart when provider env content is unchanged', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'openclaw-service-'))
    await mkdir(join(tempDir, '.openclaw'), { recursive: true })
    await writeFile(
      join(tempDir, '.openclaw', '.env'),
      'OPENAI_API_KEY=sk-test\n',
      'utf-8',
    )

    const restart = mock(async () => {})
    const service = new OpenClawService() as MutableOpenClawService

    service.openclawDir = tempDir
    service.restart = restart

    await service.updateProviderKeys({
      providerType: 'openai',
      apiKey: 'sk-test',
    })

    expect(restart).not.toHaveBeenCalled()
    expect(await readFile(join(tempDir, '.openclaw', '.env'), 'utf-8')).toBe(
      'OPENAI_API_KEY=sk-test\n',
    )
  })

  it('applies the default model when provider keys are unchanged', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'openclaw-service-'))
    await mkdir(join(tempDir, '.openclaw'), { recursive: true })
    await writeFile(
      join(tempDir, '.openclaw', '.env'),
      'OPENAI_API_KEY=sk-test\n',
      'utf-8',
    )

    const restart = mock(async () => {})
    const setDefaultModel = mock(async () => {})
    const service = new OpenClawService() as MutableOpenClawService

    service.openclawDir = tempDir
    service.restart = restart
    service.runtime = {
      isReady: async () => true,
      waitForReady: async (_port: number) => true,
    }
    service.cliClient = {
      setDefaultModel,
    }

    await expect(
      service.updateProviderKeys({
        providerType: 'openai',
        apiKey: 'sk-test',
        modelId: 'gpt-5.4-mini',
      }),
    ).resolves.toEqual({
      modelUpdated: true,
      restarted: false,
    })

    expect(setDefaultModel).toHaveBeenCalledWith('openai/gpt-5.4-mini')
    expect(restart).not.toHaveBeenCalled()
    expect(await readFile(join(tempDir, '.openclaw', '.env'), 'utf-8')).toBe(
      'OPENAI_API_KEY=sk-test\n',
    )
  })

  it('persists env updates before surfacing default-model failures', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'openclaw-service-'))
    await mkdir(join(tempDir, '.openclaw'), { recursive: true })

    const setDefaultModel = mock(async () => {
      throw new Error('container unavailable')
    })
    const restart = mock(async () => {})
    const service = new OpenClawService() as MutableOpenClawService

    service.openclawDir = tempDir
    service.restart = restart
    service.cliClient = {
      setDefaultModel,
    }

    await expect(
      service.updateProviderKeys({
        providerType: 'openai',
        apiKey: 'sk-test',
        modelId: 'gpt-5.4-mini',
      }),
    ).rejects.toThrow('container unavailable')

    expect(setDefaultModel).toHaveBeenCalledWith('openai/gpt-5.4-mini')
    expect(restart).toHaveBeenCalledTimes(1)
    expect(await readFile(join(tempDir, '.openclaw', '.env'), 'utf-8')).toBe(
      'OPENAI_API_KEY=sk-test\n',
    )
  })

  it('applyPodmanOverrides persists the override and refreshes the runtime', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'openclaw-service-'))
    const service = new OpenClawService() as MutableOpenClawService
    service.openclawDir = tempDir

    const result = await service.applyPodmanOverrides({
      podmanPath: '/opt/homebrew/bin/podman',
    })

    expect(result.podmanPath).toBe('/opt/homebrew/bin/podman')
    expect(result.effectivePodmanPath).toBe('/opt/homebrew/bin/podman')

    const persisted = JSON.parse(
      await readFile(join(tempDir, 'podman-overrides.json'), 'utf-8'),
    )
    expect(persisted).toEqual({ podmanPath: '/opt/homebrew/bin/podman' })

    const reloaded = await service.getPodmanOverrides()
    expect(reloaded.podmanPath).toBe('/opt/homebrew/bin/podman')
    expect(reloaded.effectivePodmanPath).toBe('/opt/homebrew/bin/podman')
  })

  it('applyPodmanOverrides with null clears the override and falls back', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'openclaw-service-'))
    const service = new OpenClawService({
      resourcesDir: tempDir,
    }) as MutableOpenClawService
    service.openclawDir = tempDir

    await service.applyPodmanOverrides({
      podmanPath: '/opt/homebrew/bin/podman',
    })
    const cleared = await service.applyPodmanOverrides({ podmanPath: null })

    expect(cleared.podmanPath).toBeNull()
    // resourcesDir has no bundled binary, so the runtime falls through to 'podman'
    expect(cleared.effectivePodmanPath).toBe('podman')

    const persisted = JSON.parse(
      await readFile(join(tempDir, 'podman-overrides.json'), 'utf-8'),
    )
    expect(persisted).toEqual({ podmanPath: null })
  })

  it('applyPodmanOverrides rebuilds ContainerRuntime so it picks up the new Podman reference', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'openclaw-service-'))
    const service = new OpenClawService() as MutableOpenClawService
    service.openclawDir = tempDir

    const before = service.runtime
    await service.applyPodmanOverrides({
      podmanPath: '/opt/homebrew/bin/podman',
    })

    expect(service.runtime).not.toBe(before)
  })
})
