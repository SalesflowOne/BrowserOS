/**
 * @license
 * Copyright 2025 BrowserOS
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  CODEX_CONTAINER_NAME,
  CODEX_IMAGE,
} from '../../../../../../packages/shared/src/constants/codex'
import {
  CodexRuntime,
  configureCodexRuntime,
  getAgentRuntimeRegistry,
  getCodexRuntime,
  prepareCodexContext,
  resetAgentRuntimeRegistry,
} from '../../../../src/lib/agents/runtime'
import type {
  ManagedContainerDeps,
  MountRoot,
} from '../../../../src/lib/container/managed'
import type {
  ContainerInfo,
  ContainerSpec,
} from '../../../../src/lib/container/types'

function makeAgent(id = 'agent-1') {
  return {
    id,
    name: 'Codex bot',
    adapter: 'codex' as const,
    sessionKey: `agent:${id}:main`,
    pinned: false,
    updatedAt: Date.now(),
    createdAt: Date.now(),
    modelId: 'gpt-5.5',
    reasoningEffort: 'medium',
    providerType: 'host-auth',
    providerName: null,
    baseUrl: null,
    apiKey: null,
    supportsImages: false,
  }
}

function makeDeps(opts: { lockDir: string }): {
  deps: ManagedContainerDeps
  getCapturedSpec: () => ContainerSpec | null
  getExecCommands: () => string[][]
} {
  let capturedSpec: ContainerSpec | null = null
  const execCommands: string[][] = []
  const fakeCli = {
    inspectContainer: async (): Promise<ContainerInfo | null> => ({
      id: 'cid',
      name: CODEX_CONTAINER_NAME,
      image: CODEX_IMAGE,
      status: 'running',
      running: true,
    }),
    removeContainer: async () => {},
    waitForContainerNameRelease: async () => {},
    createContainer: async (spec: ContainerSpec) => {
      capturedSpec = spec
    },
    startContainer: async () => {},
    waitForContainerRunning: async () => {},
    exec: async (_containerName: string, argv: string[]) => {
      execCommands.push(argv)
      return 0
    },
  }
  const fakeLoader = { ensureImageLoaded: async () => {} }
  const fakeVm = {
    ensureReady: async () => {},
    getDefaultGateway: async () => '192.168.5.2',
  }
  const deps: ManagedContainerDeps = {
    cli: fakeCli as unknown as ManagedContainerDeps['cli'],
    loader: fakeLoader as unknown as ManagedContainerDeps['loader'],
    vm: fakeVm as unknown as ManagedContainerDeps['vm'],
    limactlPath: '/opt/homebrew/bin/limactl',
    limaHome: '/Users/dev/.browseros/lima',
    vmName: 'browseros-vm',
    lockDir: opts.lockDir,
  }
  return {
    deps,
    getCapturedSpec: () => capturedSpec,
    getExecCommands: () => execCommands,
  }
}

describe('CodexRuntime', () => {
  const tempDirs: string[] = []

  afterEach(async () => {
    await Promise.all(
      tempDirs.map((dir) => rm(dir, { recursive: true, force: true })),
    )
    tempDirs.length = 0
    resetAgentRuntimeRegistry()
  })

  function mkTempDirSync(prefix: string): string {
    const dir = mkdtempSync(join(tmpdir(), prefix))
    tempDirs.push(dir)
    return dir
  }

  it('declares the canonical Codex descriptor', () => {
    const runtime = new CodexRuntime(
      makeDeps({ lockDir: mkTempDirSync('codex-runtime-') }).deps,
      {
        browserosDir: '/tmp/browseros',
        codexHarnessHostDir: '/tmp/browseros/vm/codex/harness',
      },
    )
    expect(runtime.descriptor.adapterId).toBe('codex')
    expect(runtime.descriptor.kind).toBe('container')
    expect(runtime.descriptor.containerName).toBe(CODEX_CONTAINER_NAME)
    expect(runtime.descriptor.defaultImage).toBe(CODEX_IMAGE)
    expect(runtime.descriptor.defaultImage).toBe(
      'docker.io/library/node:20-bookworm-slim',
    )
    expect(runtime.descriptor.readinessProbe?.timeoutMs).toBe(120_000)
  })

  it('mountRoots maps the VM-backed harness dir into the container at the same path', () => {
    const runtime = new CodexRuntime(
      makeDeps({ lockDir: mkTempDirSync('codex-runtime-') }).deps,
      {
        browserosDir: '/tmp/browseros',
        codexHarnessHostDir: '/tmp/browseros/vm/codex/harness',
      },
    )
    const mounts: readonly MountRoot[] = (
      runtime as unknown as { mountRoots(): readonly MountRoot[] }
    ).mountRoots()
    expect(mounts).toEqual([
      {
        hostPath: '/tmp/browseros/vm/codex/harness',
        containerPath: '/tmp/browseros/vm/codex/harness',
        kind: 'shared',
      },
    ])
  })

  it('builds a ContainerSpec with Codex CLI and ACP adapter install + VM harness mount + add-host', async () => {
    const { deps, getCapturedSpec, getExecCommands } = makeDeps({
      lockDir: mkTempDirSync('codex-runtime-'),
    })
    const runtime = new CodexRuntime(deps, {
      browserosDir: '/tmp/browseros',
      codexHarnessHostDir: '/tmp/browseros/vm/codex/harness',
    })

    await runtime.start()

    const spec = getCapturedSpec()
    if (!spec) throw new Error('createContainer was never called')
    expect(spec.entrypoint).toBe('/bin/sh')
    expect(spec.command).toEqual([
      '-c',
      'apt-get update && apt-get install -y --no-install-recommends ca-certificates libssl3 && rm -rf /var/lib/apt/lists/* && npm install -g @openai/codex@latest @zed-industries/codex-acp@^0.12.0 && exec sleep infinity',
    ])
    expect(spec.addHosts).toContain('host.containers.internal:192.168.5.2')
    expect(spec.mounts).toContainEqual({
      source: '/mnt/browseros/vm/codex/harness',
      target: '/tmp/browseros/vm/codex/harness',
    })
    expect(getExecCommands()).toContainEqual([
      'sh',
      '-lc',
      'command -v codex >/dev/null && command -v codex-acp >/dev/null && codex-acp --help >/dev/null',
    ])
  })

  it('getAcpExecSpec runs the Codex ACP adapter inside the container', () => {
    const runtime = new CodexRuntime(
      makeDeps({ lockDir: mkTempDirSync('codex-runtime-') }).deps,
      {
        browserosDir: '/tmp/browseros',
        codexHarnessHostDir: '/tmp/browseros/vm/codex/harness',
      },
    )

    const spec = runtime.getAcpExecSpec({ CODEX_HOME: '/tmp/codex' })

    expect(spec.argv).toEqual(['codex-acp'])
    expect(spec.env).toEqual({ CODEX_HOME: '/tmp/codex' })
  })

  it('prepareTurnContext sets VM-backed AGENT_HOME + CODEX_HOME and materializes codex home', async () => {
    const browserosDir = await mkdtemp(join(tmpdir(), 'browseros-codex-'))
    tempDirs.push(browserosDir)
    const prepared = await prepareCodexContext({
      browserosDir,
      agent: makeAgent('codex-agent'),
      sessionId: 'main',
      sessionKey: 'agent:codex-agent:main',
      cwdOverride: null,
      isSelectedCwd: false,
      message: 'hi',
    })
    expect(prepared.commandEnv.AGENT_HOME).toBe(
      join(browserosDir, 'vm', 'codex', 'harness', 'codex-agent', 'home'),
    )
    expect(prepared.commandEnv.CODEX_HOME).toBe(
      join(
        browserosDir,
        'vm',
        'codex',
        'harness',
        'codex-agent',
        'runtime',
        'codex-home',
      ),
    )
    const codexHomeStat = await stat(prepared.commandEnv.CODEX_HOME)
    expect(codexHomeStat.isDirectory()).toBe(true)
    expect(prepared.cwd).toBe(
      join(browserosDir, 'vm', 'codex', 'harness', 'workspace'),
    )
    expect(prepared.browserosMcpHost).toBe('host.containers.internal')
    expect(prepared.useBrowserosMcp).toBe(true)
  })

  it('buildExecArgv produces a limactl/nerdctl Codex ACP command', () => {
    const runtime = new CodexRuntime(
      makeDeps({ lockDir: mkTempDirSync('codex-runtime-') }).deps,
      {
        browserosDir: '/tmp/browseros',
        codexHarnessHostDir: '/tmp/browseros/vm/codex/harness',
      },
    )
    const out = runtime.buildExecArgv(
      runtime.getAcpExecSpec({
        CODEX_HOME: '/tmp/browseros/vm/codex/harness/agent/runtime/codex-home',
      }),
    )
    expect(out).toContain('LIMA_HOME=/Users/dev/.browseros/lima')
    expect(out).toContain('nerdctl exec -i')
    expect(out).toContain(CODEX_CONTAINER_NAME)
    expect(out).toContain('codex-acp')
    expect(out).toContain(
      '-e CODEX_HOME=/tmp/browseros/vm/codex/harness/agent/runtime/codex-home',
    )
  })

  describe('configureCodexRuntime', () => {
    let originalPlatform: string

    beforeEach(() => {
      originalPlatform = process.platform
    })

    afterEach(() => {
      Object.defineProperty(process, 'platform', { value: originalPlatform })
    })

    it('registers a runtime in the registry', () => {
      Object.defineProperty(process, 'platform', { value: 'darwin' })
      const runtime = configureCodexRuntime({ browserosDir: '/tmp/browseros' })
      expect(runtime).toBeInstanceOf(CodexRuntime)
      expect(getCodexRuntime()).toBe(runtime)
      expect(getAgentRuntimeRegistry().get('codex')).toBe(runtime)
    })

    it('throws on duplicate registration', () => {
      Object.defineProperty(process, 'platform', { value: 'darwin' })
      configureCodexRuntime({ browserosDir: '/tmp/browseros' })
      expect(() =>
        configureCodexRuntime({ browserosDir: '/tmp/browseros' }),
      ).toThrow(/already registered/)
    })
  })
})
