/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { join } from 'node:path'
import {
  CLAUDE_CONTAINER_NAME,
  CLAUDE_IMAGE,
} from '@browseros/shared/constants/claude'
import { getBrowserosDir } from '../../browseros-dir'
import { ContainerCli } from '../../container/container-cli'
import { ImageLoader } from '../../container/image-loader'
import type {
  ContainerDescriptor,
  ManagedContainerDeps,
  MountRoot,
} from '../../container/managed'
import type { ContainerSpec } from '../../container/types'
import { logger } from '../../logger'
import {
  GUEST_VM_STATE,
  getLimaHomeDir,
  resolveBundledLimactl,
  resolveBundledLimaTemplate,
  VM_NAME,
  VmRuntime,
} from '../../vm'
import type {
  PrepareAcpxAgentContextInput,
  PreparedAcpxAgentContext,
} from '../acpx-agent-adapter'
import {
  finishBrowserosManagedContext,
  prepareBrowserosManagedContext,
} from '../acpx-agent-common'
import {
  materializeClaudeHome,
  resolveVmAgentRuntimePaths,
} from '../acpx-runtime-context'
import { ContainerAgentRuntime } from './container-agent-runtime'
import { getAgentRuntimeRegistry } from './registry'
import type { ExecSpec } from './types'

const CLAUDE_ACP_ARGV = ['claude-agent-acp'] as const
const CLAUDE_CODE_START_COMMAND =
  'npm install -g @anthropic-ai/claude-code@latest @agentclientprotocol/claude-agent-acp@^0.31.0 && exec sleep infinity'

export interface ClaudeRuntimeConfig {
  browserosDir: string
  claudeHarnessHostDir: string
}

export class ClaudeRuntime extends ContainerAgentRuntime {
  readonly descriptor: ContainerDescriptor & { kind: 'container' } = {
    adapterId: 'claude',
    displayName: 'Claude Code',
    kind: 'container',
    defaultImage: CLAUDE_IMAGE,
    containerName: CLAUDE_CONTAINER_NAME,
    platforms: ['darwin'],
    readinessProbe: { timeoutMs: 120_000, intervalMs: 500 },
  }

  private readonly claudeConfig: ClaudeRuntimeConfig

  constructor(deps: ManagedContainerDeps, config: ClaudeRuntimeConfig) {
    super(deps)
    this.claudeConfig = config
  }

  protected mountRoots(): readonly MountRoot[] {
    return [
      {
        hostPath: this.claudeConfig.claudeHarnessHostDir,
        containerPath: this.claudeConfig.claudeHarnessHostDir,
        kind: 'shared',
      },
    ]
  }

  protected async buildContainerSpec(): Promise<ContainerSpec> {
    const guestHarnessDir = `${GUEST_VM_STATE}/claude/harness`
    const gateway = await this.deps.vm.getDefaultGateway()
    return {
      name: CLAUDE_CONTAINER_NAME,
      image: CLAUDE_IMAGE,
      restart: 'unless-stopped',
      addHosts: [`host.containers.internal:${gateway}`],
      mounts: [
        {
          source: guestHarnessDir,
          target: this.claudeConfig.claudeHarnessHostDir,
        },
      ],
      entrypoint: '/bin/sh',
      command: ['-c', CLAUDE_CODE_START_COMMAND],
    }
  }

  protected async readinessProbe(): Promise<boolean> {
    try {
      const exitCode = await this.deps.cli.exec(this.descriptor.containerName, [
        'sh',
        '-lc',
        'command -v claude >/dev/null && command -v claude-agent-acp >/dev/null',
      ])
      return exitCode === 0
    } catch {
      return false
    }
  }

  getPerAgentHomeDir(agentId: string): string {
    return resolveVmAgentRuntimePaths({
      browserosDir: this.claudeConfig.browserosDir,
      adapter: 'claude',
      agentId,
    }).agentHome
  }

  getAcpExecSpec(commandEnv: Record<string, string>): ExecSpec {
    return {
      argv: [...CLAUDE_ACP_ARGV],
      env: { ...commandEnv },
    }
  }

  prepareTurnContext(
    input: PrepareAcpxAgentContextInput,
  ): Promise<PreparedAcpxAgentContext> {
    return prepareClaudeCodeContext(input)
  }
}

/** Prepares Claude Code with a VM-visible BrowserOS agent home. */
export async function prepareClaudeCodeContext(
  input: PrepareAcpxAgentContextInput,
): Promise<PreparedAcpxAgentContext> {
  const paths = resolveVmAgentRuntimePaths({
    browserosDir: input.browserosDir,
    adapter: 'claude',
    agentId: input.agent.id,
  })
  const common = await prepareBrowserosManagedContext(input, {
    paths,
    isDefaultWorkspace: true,
  })
  await materializeClaudeHome({ paths: common.paths })
  return finishBrowserosManagedContext({
    ...common,
    commandEnv: {
      AGENT_HOME: common.paths.agentHome,
      HOME: common.paths.agentHome,
    },
    browserosMcpHost: 'host.containers.internal',
  })
}

export interface ConfigureClaudeRuntimeOptions {
  resourcesDir?: string
  browserosDir?: string
}

export function configureClaudeRuntime(
  options: ConfigureClaudeRuntimeOptions = {},
): ClaudeRuntime | null {
  if (process.platform !== 'darwin') {
    logger.warn('Claude runtime skipped: unsupported platform', {
      platform: process.platform,
    })
    return null
  }

  const browserosDir = options.browserosDir ?? getBrowserosDir()
  const resourcesDir = options.resourcesDir ?? null
  const limactlPath = resourcesDir
    ? resolveBundledLimactl(resourcesDir)
    : 'limactl'
  const limaHome = getLimaHomeDir(browserosDir)
  const claudeHostStateDir = join(browserosDir, 'vm', 'claude')
  const claudeHarnessHostDir = join(claudeHostStateDir, 'harness')

  const vm = new VmRuntime({
    limactlPath,
    limaHome,
    templatePath: resourcesDir
      ? resolveBundledLimaTemplate(resourcesDir)
      : undefined,
    browserosRoot: browserosDir,
  })
  const cli = new ContainerCli({ limactlPath, limaHome, vmName: VM_NAME })
  const loader = new ImageLoader(cli)

  const runtime = new ClaudeRuntime(
    {
      cli,
      loader,
      vm,
      limactlPath,
      limaHome,
      vmName: VM_NAME,
      lockDir: join(claudeHostStateDir, '.locks'),
    },
    { browserosDir, claudeHarnessHostDir },
  )
  getAgentRuntimeRegistry().register(runtime)
  logger.debug('ClaudeRuntime registered', { image: CLAUDE_IMAGE })
  return runtime
}

export function getClaudeRuntime(): ClaudeRuntime | null {
  const r = getAgentRuntimeRegistry().get('claude')
  return r instanceof ClaudeRuntime ? r : null
}
