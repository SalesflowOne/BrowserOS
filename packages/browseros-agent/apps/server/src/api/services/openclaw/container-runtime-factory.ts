/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { cpSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { getBrowserosDir } from '../../../lib/browseros-dir'
import { logger } from '../../../lib/logger'
import { ImageLoader, PodmanShell } from '../../../lib/podman'
import {
  detectArch,
  getLimaHomeDir,
  resolveBundledLimactl,
  resolveBundledLimaTemplate,
  VM_NAME,
  VmRuntime,
} from '../../../lib/vm'
import { readCachedManifest } from '../../../lib/vm/manifest'
import { VM_TELEMETRY_EVENTS } from '../../../lib/vm/telemetry'
import { ContainerRuntime } from './container-runtime'

export interface ContainerRuntimeFactoryInput {
  resourcesDir?: string
  projectDir: string
  browserosRoot?: string
  platform?: NodeJS.Platform
}

let legacyPodmanLogged = false

export function buildContainerRuntime(
  input: ContainerRuntimeFactoryInput,
): ContainerRuntime {
  const platform = input.platform ?? process.platform
  if (platform !== 'darwin') {
    throw new Error(
      'browseros-vm currently supports macOS only; see the Linux/Windows tracking issue',
    )
  }

  const browserosRoot = input.browserosRoot ?? getBrowserosDir()
  if (input.resourcesDir) {
    migrateLegacyOpenClawDirSync(browserosRoot)
    void logLegacyPodmanMachineIfPresent()
  }

  const limactlPath = input.resourcesDir
    ? resolveBundledLimactl(input.resourcesDir)
    : 'limactl'
  const limaHome = getLimaHomeDir(browserosRoot)
  const vm = new VmRuntime({
    limactlPath,
    limaHome,
    templatePath: input.resourcesDir
      ? resolveBundledLimaTemplate(input.resourcesDir)
      : undefined,
    browserosRoot,
  })
  const shell = new PodmanShell({ limactlPath, limaHome, vmName: VM_NAME })
  const loader = new DeferredImageLoader(shell, browserosRoot)

  return new ContainerRuntime({
    vm,
    shell,
    loader,
    projectDir: input.projectDir,
  })
}

export async function migrateLegacyOpenClawDir(
  browserosRoot = getBrowserosDir(),
): Promise<void> {
  migrateLegacyOpenClawDirSync(browserosRoot)
}

function migrateLegacyOpenClawDirSync(browserosRoot = getBrowserosDir()): void {
  const legacyDir = join(browserosRoot, 'openclaw')
  const nextDir = join(browserosRoot, 'vm', 'openclaw')
  if (!existsSync(legacyDir)) return
  if (existsSync(nextDir)) {
    logger.warn('OpenClaw legacy and VM state directories both exist', {
      legacyDir,
      nextDir,
    })
    return
  }

  mkdirSync(dirname(nextDir), { recursive: true })
  cpSync(legacyDir, nextDir, { recursive: true })
  logger.info(VM_TELEMETRY_EVENTS.migrationOpenClawMoved, {
    from: legacyDir,
    to: nextDir,
  })
}

export async function logLegacyPodmanMachineIfPresent(
  spawn: typeof Bun.spawn = Bun.spawn,
): Promise<void> {
  if (legacyPodmanLogged) return
  try {
    const proc = spawn(['podman', 'machine', 'list', '--format', 'json'], {
      stdout: 'pipe',
      stderr: 'ignore',
    })
    const [stdout, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      proc.exited,
    ])
    if (exitCode !== 0 || !stdout.trim()) return
    const machines = JSON.parse(stdout) as unknown[]
    if (!Array.isArray(machines) || machines.length === 0) return
    legacyPodmanLogged = true
    logger.warn(VM_TELEMETRY_EVENTS.migrationLegacyPodmanDetected, {
      count: machines.length,
    })
  } catch {
    return
  }
}

class DeferredImageLoader {
  constructor(
    private readonly shell: PodmanShell,
    private readonly browserosRoot: string,
  ) {}

  async ensureImageLoaded(ref: string, onLog?: (msg: string) => void) {
    const manifest = await readCachedManifest(this.browserosRoot)
    const loader = new ImageLoader(this.shell, manifest, detectArch())
    await loader.ensureImageLoaded(ref, onLog)
  }
}
