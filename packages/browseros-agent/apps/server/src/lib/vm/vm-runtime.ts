/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { createReadStream, createWriteStream, existsSync } from 'node:fs'
import { mkdir, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import * as zlib from 'node:zlib'
import type { VmManifest } from '@browseros/build-tools/scripts/common/manifest'
import { logger } from '../logger'
import { LimaCommandError, VmError, VmNotReadyError } from './errors'
import { LimaCli } from './lima-cli'
import { generateLimaYaml } from './lima-config'
import {
  compareVersions,
  readCachedManifest,
  readInstalledManifest,
  writeInstalledManifest,
} from './manifest'
import {
  type Arch,
  compressedDiskPath,
  decompressedDiskPath,
  detectArch,
  getImageCacheDir,
  getLimaSocketPath,
  getVmStateDir,
  VM_NAME,
} from './paths'
import { VM_TELEMETRY_EVENTS } from './telemetry'

export type LogFn = (msg: string) => void

export interface VmRuntimeDeps {
  limactlPath: string
  limaHome: string
  browserosRoot?: string
  arch?: Arch
  socketTimeoutMs?: number
  socketPollMs?: number
  decompressDisk?: (compressedPath: string, rawPath: string) => Promise<void>
}

export class VmRuntime {
  private readonly cli: LimaCli
  private readonly socketTimeoutMs: number
  private readonly socketPollMs: number
  private readonly decompressDisk: (
    compressedPath: string,
    rawPath: string,
  ) => Promise<void>

  constructor(private readonly deps: VmRuntimeDeps) {
    this.cli = new LimaCli({
      limactlPath: deps.limactlPath,
      limaHome: deps.limaHome,
    })
    this.socketTimeoutMs = deps.socketTimeoutMs ?? 60_000
    this.socketPollMs = deps.socketPollMs ?? 500
    this.decompressDisk = deps.decompressDisk ?? decompressZstd
  }

  async ensureReady(onLog?: LogFn): Promise<void> {
    const cached = await readCachedManifest(this.deps.browserosRoot)
    const installed = await readInstalledManifest(this.deps.browserosRoot)
    const versionComparison = compareVersions(installed, cached)
    const vms = await this.cli.list()
    const existing = vms.find((vm) => vm.name === VM_NAME)

    if (!existing) {
      await this.provisionFresh(cached, onLog)
    } else if (existing.status !== 'Running') {
      onLog?.('Starting BrowserOS VM...')
      await this.cli.start(VM_NAME)
    } else if (versionComparison === 'upgrade') {
      logger.warn(VM_TELEMETRY_EVENTS.upgradeDetected, {
        from: installed?.vmVersion ?? null,
        to: cached.vmVersion,
      })
    }

    await this.waitForSocket(this.socketTimeoutMs)
    await writeInstalledManifest(cached, this.deps.browserosRoot)
  }

  async stopVm(): Promise<void> {
    try {
      await this.cli.stop(VM_NAME)
    } catch (error) {
      if (error instanceof LimaCommandError && isAlreadyStopped(error.stderr)) {
        return
      }
      throw error
    }
  }

  async runCommand(
    args: string[],
    opts?: { onOutput?: LogFn },
  ): Promise<number> {
    return this.cli.shell(VM_NAME, args, {
      onStdout: opts?.onOutput,
      onStderr: opts?.onOutput,
    })
  }

  async listRunningContainers(): Promise<string[]> {
    const lines: string[] = []
    await this.runCommand(['podman', 'ps', '--format', '{{.Names}}'], {
      onOutput: (line) => lines.push(line),
    })
    return lines.map((line) => line.trim()).filter(Boolean)
  }

  tailContainerLogs(containerName: string, onLine: LogFn): () => void {
    const proc = Bun.spawn(
      [
        this.deps.limactlPath,
        'shell',
        VM_NAME,
        '--',
        'podman',
        'logs',
        '-f',
        '--tail',
        '0',
        containerName,
      ],
      {
        env: { ...process.env, LIMA_HOME: this.deps.limaHome },
        stdout: 'pipe',
        stderr: 'pipe',
      },
    )
    void drainStream(proc.stdout ?? null, onLine)
    void drainStream(proc.stderr ?? null, onLine)

    let stopped = false
    return () => {
      if (stopped) return
      stopped = true
      try {
        proc.kill()
      } catch {
        return
      }
    }
  }

  async reset(_reason: string): Promise<never> {
    throw notImplemented('VmRuntime.reset')
  }

  async performUpgrade(): Promise<never> {
    throw notImplemented('VmRuntime.performUpgrade')
  }

  async isReady(): Promise<boolean> {
    try {
      const info = await stat(this.socketPath())
      return info.isSocket()
    } catch {
      return false
    }
  }

  getLimactlPath(): string {
    return this.deps.limactlPath
  }

  private async provisionFresh(
    cached: VmManifest,
    onLog?: LogFn,
  ): Promise<void> {
    const arch = this.arch()
    const diskPath = await this.prepareDisk(cached.vmVersion, arch)
    const yaml = generateLimaYaml({
      arch,
      diskPath,
      cpus: 2,
      memory: '2GiB',
      disk: '10GiB',
      vmStateDir: getVmStateDir(this.deps.browserosRoot),
      imageCacheDir: getImageCacheDir(this.deps.browserosRoot),
      socketHostPath: this.socketPath(),
    })
    const yamlPath = join(this.deps.limaHome, `${VM_NAME}.yaml`)
    await mkdir(dirname(yamlPath), { recursive: true })
    await writeFile(yamlPath, yaml)

    onLog?.('Creating BrowserOS VM...')
    await this.cli.create(VM_NAME, yamlPath)
    onLog?.('Starting BrowserOS VM...')
    await this.cli.start(VM_NAME)
  }

  private async prepareDisk(version: string, arch: Arch): Promise<string> {
    const raw = decompressedDiskPath(version, arch, this.deps.browserosRoot)
    if (await hasNonZeroFile(raw)) return raw

    const compressed = compressedDiskPath(
      version,
      arch,
      this.deps.browserosRoot,
    )
    if (!existsSync(compressed)) {
      throw new Error(
        `VM disk is missing at ${compressed}; run bun run cache:sync before starting the server`,
      )
    }

    await mkdir(dirname(raw), { recursive: true })
    await this.decompressDisk(compressed, raw)
    return raw
  }

  private async waitForSocket(timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      if (await this.isReady()) return
      await Bun.sleep(this.socketPollMs)
    }
    throw new VmNotReadyError(
      `podman.sock never appeared at ${this.socketPath()}`,
    )
  }

  private arch(): Arch {
    return this.deps.arch ?? detectArch()
  }

  private socketPath(): string {
    return getLimaSocketPath(this.deps.browserosRoot)
  }
}

function notImplemented(feature: string): VmError {
  return new VmError(
    `${feature} is not implemented yet - see WS4 follow-up plan`,
  )
}

async function hasNonZeroFile(path: string): Promise<boolean> {
  try {
    const info = await stat(path)
    return info.isFile() && info.size > 0
  } catch {
    return false
  }
}

async function decompressZstd(
  compressedPath: string,
  rawPath: string,
): Promise<void> {
  await mkdir(dirname(rawPath), { recursive: true })
  try {
    const proc = Bun.spawn(
      ['zstd', '-d', '-f', '-o', rawPath, compressedPath],
      {
        stdout: 'ignore',
        stderr: 'pipe',
      },
    )
    const [stderr, code] = await Promise.all([
      new Response(proc.stderr).text(),
      proc.exited,
    ])
    if (code === 0) return
    throw new Error(stderr)
  } catch (error) {
    await decompressZstdWithNode(compressedPath, rawPath, error)
  }
}

async function decompressZstdWithNode(
  compressedPath: string,
  rawPath: string,
  originalError: unknown,
): Promise<void> {
  const createZstdDecompress = (
    zlib as typeof zlib & {
      createZstdDecompress?: () => NodeJS.ReadWriteStream
    }
  ).createZstdDecompress
  if (!createZstdDecompress) {
    throw new Error(
      `failed to decompress ${compressedPath}; install zstd or use a Node build with zstd support: ${String(originalError)}`,
    )
  }
  await pipeline(
    createReadStream(compressedPath),
    createZstdDecompress(),
    createWriteStream(rawPath),
  )
}

function isAlreadyStopped(stderr: string): boolean {
  const lower = stderr.toLowerCase()
  return (
    lower.includes('not running') ||
    lower.includes('already stopped') ||
    lower.includes('not found')
  )
}

async function drainStream(
  stream: ReadableStream<Uint8Array> | null,
  onLine: LogFn,
): Promise<void> {
  if (!stream) return
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (line.trim()) onLine(line.trim())
    }
  }

  if (buffer.trim()) onLine(buffer.trim())
}
