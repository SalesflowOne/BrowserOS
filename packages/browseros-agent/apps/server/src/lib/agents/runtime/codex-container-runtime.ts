/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { join } from 'node:path'
import {
  CODEX_CONTAINER_NAME,
  CODEX_IMAGE,
} from '@browseros/shared/constants/codex'
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
  materializeCodexHome,
  resolveVmAgentRuntimePaths,
} from '../acpx-runtime-context'
import { ContainerAgentRuntime } from './container-agent-runtime'
import { getAgentRuntimeRegistry } from './registry'
import type { ExecSpec } from './types'

const CODEX_ACP_ARGV = ['codex-acp'] as const
const CODEX_START_COMMAND =
  'apt-get update && apt-get install -y --no-install-recommends ca-certificates libssl3 && rm -rf /var/lib/apt/lists/* && npm install -g @openai/codex@latest @zed-industries/codex-acp@^0.12.0 && exec sleep infinity'

export interface CodexRuntimeConfig {
  browserosDir: string
  codexHarnessHostDir: string
}

export class CodexRuntime extends ContainerAgentRuntime {
  readonly descriptor: ContainerDescriptor & { kind: 'container' } = {
    adapterId: 'codex',
    displayName: 'Codex',
    kind: 'container',
    defaultImage: CODEX_IMAGE,
    containerName: CODEX_CONTAINER_NAME,
    platforms: ['darwin'],
    readinessProbe: { timeoutMs: 120_000, intervalMs: 500 },
  }

  private readonly codexConfig: CodexRuntimeConfig

  constructor(deps: ManagedContainerDeps, config: CodexRuntimeConfig) {
    super(deps)
    this.codexConfig = config
  }

  protected mountRoots(): readonly MountRoot[] {
    return [
      {
        hostPath: this.codexConfig.codexHarnessHostDir,
        containerPath: this.codexConfig.codexHarnessHostDir,
        kind: 'shared',
      },
    ]
  }

  protected async buildContainerSpec(): Promise<ContainerSpec> {
    const guestHarnessDir = `${GUEST_VM_STATE}/codex/harness`
    const gateway = await this.deps.vm.getDefaultGateway()
    return {
      name: CODEX_CONTAINER_NAME,
      image: CODEX_IMAGE,
      restart: 'unless-stopped',
      addHosts: [`host.containers.internal:${gateway}`],
      mounts: [
        {
          source: guestHarnessDir,
          target: this.codexConfig.codexHarnessHostDir,
        },
      ],
      entrypoint: '/bin/sh',
      command: ['-c', CODEX_START_COMMAND],
    }
  }

  protected async readinessProbe(): Promise<boolean> {
    try {
      const exitCode = await this.deps.cli.exec(this.descriptor.containerName, [
        'sh',
        '-lc',
        'command -v codex >/dev/null && command -v codex-acp >/dev/null && codex-acp --help >/dev/null',
      ])
      return exitCode === 0
    } catch {
      return false
    }
  }

  getPerAgentHomeDir(agentId: string): string {
    return resolveVmAgentRuntimePaths({
      browserosDir: this.codexConfig.browserosDir,
      adapter: 'codex',
      agentId,
    }).agentHome
  }

  getAcpExecSpec(commandEnv: Record<string, string>): ExecSpec {
    return {
      argv: [...CODEX_ACP_ARGV],
      env: { ...commandEnv },
    }
  }

  prepareTurnContext(
    input: PrepareAcpxAgentContextInput,
  ): Promise<PreparedAcpxAgentContext> {
    return prepareCodexContext(input)
  }
}

/** Prepares Codex with VM-visible AGENT_HOME and CODEX_HOME. */
export async function prepareCodexContext(
  input: PrepareAcpxAgentContextInput,
): Promise<PreparedAcpxAgentContext> {
  const paths = resolveVmAgentRuntimePaths({
    browserosDir: input.browserosDir,
    adapter: 'codex',
    agentId: input.agent.id,
  })
  const common = await prepareBrowserosManagedContext(input, {
    paths,
    isDefaultWorkspace: true,
  })
  await materializeCodexHome({
    paths: common.paths,
    skillNames: common.skillNames,
  })
  return finishBrowserosManagedContext({
    ...common,
    commandEnv: {
      AGENT_HOME: common.paths.agentHome,
      CODEX_HOME: common.paths.codexHome,
      HOME: common.paths.agentHome,
    },
    browserosMcpHost: 'host.containers.internal',
  })
}

export interface ConfigureCodexRuntimeOptions {
  resourcesDir?: string
  browserosDir?: string
}

export function configureCodexRuntime(
  options: ConfigureCodexRuntimeOptions = {},
): CodexRuntime | null {
  if (process.platform !== 'darwin') {
    logger.warn('Codex runtime skipped: unsupported platform', {
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
  const codexHostStateDir = join(browserosDir, 'vm', 'codex')
  const codexHarnessHostDir = join(codexHostStateDir, 'harness')

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

  const runtime = new CodexRuntime(
    {
      cli,
      loader,
      vm,
      limactlPath,
      limaHome,
      vmName: VM_NAME,
      lockDir: join(codexHostStateDir, '.locks'),
    },
    { browserosDir, codexHarnessHostDir },
  )
  getAgentRuntimeRegistry().register(runtime)
  logger.debug('CodexRuntime registered', { image: CODEX_IMAGE })
  return runtime
}

export function getCodexRuntime(): CodexRuntime | null {
  const r = getAgentRuntimeRegistry().get('codex')
  return r instanceof CodexRuntime ? r : null
}
