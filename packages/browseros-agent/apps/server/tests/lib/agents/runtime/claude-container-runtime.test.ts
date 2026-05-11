/**
 * @license
 * Copyright 2025 BrowserOS
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  CLAUDE_CONTAINER_NAME,
  CLAUDE_IMAGE,
} from '../../../../../../packages/shared/src/constants/claude'
import {
  ClaudeRuntime,
  configureClaudeRuntime,
  getAgentRuntimeRegistry,
  getClaudeRuntime,
  prepareClaudeCodeContext,
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
    name: 'Claude bot',
    adapter: 'claude' as const,
    sessionKey: `agent:${id}:main`,
    pinned: false,
    updatedAt: Date.now(),
    createdAt: Date.now(),
    modelId: 'claude-opus-4-5',
    reasoningEffort: 'medium',
    providerType: 'host-auth',
    providerName: null,
    baseUrl: null,
    apiKey: null,
    supportsImages: true,
  }
}

function makeDeps(opts: { lockDir: string }): {
  deps: ManagedContainerDeps
  getCapturedSpec: () => ContainerSpec | null
} {
  let capturedSpec: ContainerSpec | null = null
  const fakeCli = {
    inspectContainer: async (): Promise<ContainerInfo | null> => ({
      id: 'cid',
      name: CLAUDE_CONTAINER_NAME,
      image: CLAUDE_IMAGE,
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
    exec: async () => 0,
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
  return { deps, getCapturedSpec: () => capturedSpec }
}

describe('ClaudeRuntime', () => {
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

  it('declares the canonical Claude descriptor', () => {
    const runtime = new ClaudeRuntime(
      makeDeps({ lockDir: mkTempDirSync('claude-runtime-') }).deps,
      {
        browserosDir: '/tmp/browseros',
        claudeHarnessHostDir: '/tmp/browseros/vm/claude/harness',
      },
    )
    expect(runtime.descriptor.adapterId).toBe('claude')
    expect(runtime.descriptor.kind).toBe('container')
    expect(runtime.descriptor.containerName).toBe(CLAUDE_CONTAINER_NAME)
    expect(runtime.descriptor.defaultImage).toBe(CLAUDE_IMAGE)
    expect(runtime.descriptor.defaultImage).toBe(
      'docker.io/library/node:20-bookworm-slim',
    )
    expect(runtime.descriptor.platforms).toContain('darwin')
    expect(runtime.descriptor.readinessProbe?.timeoutMs).toBe(120_000)
  })

  it('mountRoots maps the VM-backed harness dir into the container at the same path', () => {
    const runtime = new ClaudeRuntime(
      makeDeps({ lockDir: mkTempDirSync('claude-runtime-') }).deps,
      {
        browserosDir: '/tmp/browseros',
        claudeHarnessHostDir: '/tmp/browseros/vm/claude/harness',
      },
    )
    const mounts: readonly MountRoot[] = (
      runtime as unknown as { mountRoots(): readonly MountRoot[] }
    ).mountRoots()
    expect(mounts).toEqual([
      {
        hostPath: '/tmp/browseros/vm/claude/harness',
        containerPath: '/tmp/browseros/vm/claude/harness',
        kind: 'shared',
      },
    ])
  })

  it('builds a ContainerSpec that installs Claude Code using the devcontainer npm path', async () => {
    const lockDir = mkTempDirSync('claude-runtime-')
    const { deps, getCapturedSpec } = makeDeps({ lockDir })
    const runtime = new ClaudeRuntime(deps, {
      browserosDir: '/tmp/browseros',
      claudeHarnessHostDir: '/tmp/browseros/vm/claude/harness',
    })

    await runtime.start()

    const spec = getCapturedSpec()
    if (!spec) throw new Error('createContainer was never called')
    expect(spec.entrypoint).toBe('/bin/sh')
    expect(spec.command).toEqual([
      '-c',
      'npm install -g @anthropic-ai/claude-code@latest @agentclientprotocol/claude-agent-acp@^0.31.0 && exec sleep infinity',
    ])
    expect(spec.addHosts).toContain('host.containers.internal:192.168.5.2')
    expect(spec.mounts).toContainEqual({
      source: '/mnt/browseros/vm/claude/harness',
      target: '/tmp/browseros/vm/claude/harness',
    })
  })

  it('getPerAgentHomeDir resolves the VM-backed agent home path', () => {
    const runtime = new ClaudeRuntime(
      makeDeps({ lockDir: mkTempDirSync('claude-runtime-') }).deps,
      {
        browserosDir: '/tmp/browseros',
        claudeHarnessHostDir: '/tmp/browseros/vm/claude/harness',
      },
    )
    expect(runtime.getPerAgentHomeDir('agent-7')).toBe(
      '/tmp/browseros/vm/claude/harness/agent-7/home',
    )
  })

  it('getAcpExecSpec runs the Claude ACP adapter inside the container', () => {
    const runtime = new ClaudeRuntime(
      makeDeps({ lockDir: mkTempDirSync('claude-runtime-') }).deps,
      {
        browserosDir: '/tmp/browseros',
        claudeHarnessHostDir: '/tmp/browseros/vm/claude/harness',
      },
    )

    const spec = runtime.getAcpExecSpec({ AGENT_HOME: '/tmp/agent' })

    expect(spec.argv).toEqual(['claude-agent-acp'])
    expect(spec.env).toEqual({ AGENT_HOME: '/tmp/agent' })
  })

  it('prepareTurnContext sets VM-backed AGENT_HOME and not CODEX_HOME', async () => {
    const browserosDir = await mkdtemp(join(tmpdir(), 'browseros-claude-'))
    tempDirs.push(browserosDir)
    const prepared = await prepareClaudeCodeContext({
      browserosDir,
      agent: makeAgent('claude-agent'),
      sessionId: 'main',
      sessionKey: 'agent:claude-agent:main',
      cwdOverride: null,
      isSelectedCwd: false,
      message: 'hi',
    })
    const agentHome = join(
      browserosDir,
      'vm',
      'claude',
      'harness',
      'claude-agent',
      'home',
    )
    expect(prepared.commandEnv).toEqual({
      AGENT_HOME: agentHome,
      HOME: agentHome,
    })
    expect(prepared.cwd).toBe(
      join(browserosDir, 'vm', 'claude', 'harness', 'workspace'),
    )
    expect(prepared.runPrompt).toContain(
      `AGENT_HOME=${join(
        browserosDir,
        'vm',
        'claude',
        'harness',
        'claude-agent',
        'home',
      )}`,
    )
    expect(prepared.commandEnv).not.toHaveProperty('CODEX_HOME')
    expect(prepared.browserosMcpHost).toBe('host.containers.internal')
    expect(prepared.useBrowserosMcp).toBe(true)
  })

  it('prepareTurnContext ignores selected host cwd for container safety', async () => {
    const browserosDir = await mkdtemp(join(tmpdir(), 'browseros-claude-'))
    const selectedCwd = await mkdtemp(join(tmpdir(), 'selected-cwd-'))
    tempDirs.push(browserosDir, selectedCwd)
    const prepared = await prepareClaudeCodeContext({
      browserosDir,
      agent: makeAgent('claude-agent'),
      sessionId: 'main',
      sessionKey: 'agent:claude-agent:main',
      cwdOverride: selectedCwd,
      isSelectedCwd: true,
      message: 'hi',
    })
    expect(prepared.cwd).toBe(
      join(browserosDir, 'vm', 'claude', 'harness', 'workspace'),
    )
    expect(prepared.cwd).not.toBe(selectedCwd)
  })

  it('buildExecArgv produces a limactl/nerdctl Claude ACP command', () => {
    const runtime = new ClaudeRuntime(
      makeDeps({ lockDir: mkTempDirSync('claude-runtime-') }).deps,
      {
        browserosDir: '/tmp/browseros',
        claudeHarnessHostDir: '/tmp/browseros/vm/claude/harness',
      },
    )
    const out = runtime.buildExecArgv(
      runtime.getAcpExecSpec({
        AGENT_HOME: '/tmp/browseros/vm/claude/harness/agent/home',
      }),
    )
    expect(out).toContain('LIMA_HOME=/Users/dev/.browseros/lima')
    expect(out).toContain('nerdctl exec -i')
    expect(out).toContain(CLAUDE_CONTAINER_NAME)
    expect(out).toContain('claude-agent-acp')
    expect(out).toContain(
      '-e AGENT_HOME=/tmp/browseros/vm/claude/harness/agent/home',
    )
  })

  it('prepareTurnContext default workspace is under the Claude VM harness', async () => {
    const browserosDir = await mkdtemp(join(tmpdir(), 'browseros-claude-'))
    tempDirs.push(browserosDir)
    const prepared = await prepareClaudeCodeContext({
      browserosDir,
      agent: makeAgent('claude-agent'),
      sessionId: 'main',
      sessionKey: 'agent:claude-agent:main',
      cwdOverride: null,
      isSelectedCwd: false,
      message: 'hi',
    })
    expect(prepared.cwd).toBe(
      join(browserosDir, 'vm', 'claude', 'harness', 'workspace'),
    )
  })

  describe('configureClaudeRuntime', () => {
    let originalPlatform: string

    beforeEach(() => {
      originalPlatform = process.platform
    })

    afterEach(() => {
      Object.defineProperty(process, 'platform', { value: originalPlatform })
    })

    it('registers a runtime in the registry', () => {
      const browserosDir = '/tmp/browseros'
      Object.defineProperty(process, 'platform', { value: 'darwin' })
      const runtime = configureClaudeRuntime({ browserosDir })
      expect(runtime).toBeInstanceOf(ClaudeRuntime)
      expect(getClaudeRuntime()).toBe(runtime)
      expect(getAgentRuntimeRegistry().get('claude')).toBe(runtime)
    })

    it('throws on duplicate registration', () => {
      Object.defineProperty(process, 'platform', { value: 'darwin' })
      configureClaudeRuntime({ browserosDir: '/tmp/browseros' })
      expect(() =>
        configureClaudeRuntime({ browserosDir: '/tmp/browseros' }),
      ).toThrow(/already registered/)
    })
  })
})
