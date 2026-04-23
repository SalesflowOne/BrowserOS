/**
 * @license
 * Copyright 2025 BrowserOS
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { VmManifest } from '@browseros/build-tools/scripts/common/manifest'
import { logger } from '../../../src/lib/logger'
import { VmNotReadyError } from '../../../src/lib/vm/errors'
import {
  compressedDiskPath,
  getCachedManifestPath,
  getInstalledManifestPath,
  getLimaSocketPath,
  VM_NAME,
} from '../../../src/lib/vm/paths'
import { VM_TELEMETRY_EVENTS } from '../../../src/lib/vm/telemetry'
import { VmRuntime } from '../../../src/lib/vm/vm-runtime'
import { fakeLimactl } from '../../__helpers__/fake-limactl'

const manifest: VmManifest = {
  schemaVersion: 1,
  vmVersion: '2026.04.22',
  updatedAt: '2026-04-22T00:00:00.000Z',
  vmDisk: {
    arm64: {
      key: 'vm/browseros-vm-2026.04.22-arm64.qcow2.zst',
      sha256: 'disk-arm',
      sizeBytes: 1,
    },
    x64: {
      key: 'vm/browseros-vm-2026.04.22-x64.qcow2.zst',
      sha256: 'disk-x64',
      sizeBytes: 1,
    },
  },
  agents: {
    openclaw: {
      image: 'ghcr.io/openclaw/openclaw',
      version: '2026.4.12',
      tarballs: {
        arm64: {
          key: 'vm/images/openclaw-2026.4.12-arm64.tar.gz',
          sha256: 'agent-arm',
          sizeBytes: 1,
        },
        x64: {
          key: 'vm/images/openclaw-2026.4.12-x64.tar.gz',
          sha256: 'agent-x64',
          sizeBytes: 1,
        },
      },
    },
  },
}

describe('VmRuntime', () => {
  let root: string
  let limaHome: string
  let logPath: string
  let socketServer: ReturnType<typeof Bun.listen> | null

  beforeEach(async () => {
    root = await mkdtemp('/tmp/vmrt-')
    limaHome = join(root, 'lima')
    logPath = join(root, 'limactl.log')
    socketServer = null
    await writeCachedManifest(root)
    await writeFile(
      compressedDiskPath(manifest.vmVersion, 'arm64', root),
      'zst',
    )
  })

  afterEach(async () => {
    socketServer?.stop(true)
    await rm(root, { recursive: true, force: true })
  })

  it('provisions a fresh VM, waits for the socket, and installs the manifest', async () => {
    const limactlPath = await fakeLimactl(
      { list: { stdout: '' }, create: {}, start: {} },
      logPath,
    )
    const decompressions: Array<{ from: string; to: string }> = []
    const runtime = new VmRuntime({
      limactlPath,
      limaHome,
      browserosRoot: root,
      arch: 'arm64',
      decompressDisk: async (from, to) => {
        decompressions.push({ from, to })
        await writeFile(to, 'qcow2')
      },
    })
    socketServer = await createSocket(getLimaSocketPath(root))

    await runtime.ensureReady()

    expect(decompressions).toHaveLength(1)
    const log = await readFile(logPath, 'utf8')
    expect(log).toContain(`ARGS:create --tty=false --name=${VM_NAME}`)
    expect(log).toContain(`ARGS:start --tty=false ${VM_NAME}`)
    await expect(
      readFile(getInstalledManifestPath(root), 'utf8'),
    ).resolves.toContain(manifest.vmVersion)
    await expect(
      readFile(join(limaHome, `${VM_NAME}.yaml`), 'utf8'),
    ).resolves.toContain('vmType: "vz"')
  })

  it('returns fast when the VM is already running and manifests match', async () => {
    await writeInstalledManifest(root)
    const limactlPath = await fakeLimactl(
      {
        list: {
          stdout: JSON.stringify([
            { name: VM_NAME, status: 'Running', dir: limaHome },
          ]),
        },
        create: { stderr: 'should not create', exit: 9 },
        start: { stderr: 'should not start', exit: 9 },
      },
      logPath,
    )
    const runtime = new VmRuntime({
      limactlPath,
      limaHome,
      browserosRoot: root,
      arch: 'arm64',
    })
    socketServer = await createSocket(getLimaSocketPath(root))

    await runtime.ensureReady()

    const log = await readFile(logPath, 'utf8')
    expect(log).toContain('ARGS:list --format json')
    expect(log).not.toContain('ARGS:create')
    expect(log).not.toContain('ARGS:start')
  })

  it('starts an existing stopped VM without recreating it', async () => {
    await writeInstalledManifest(root)
    const limactlPath = await fakeLimactl(
      {
        list: {
          stdout: JSON.stringify([
            { name: VM_NAME, status: 'Stopped', dir: limaHome },
          ]),
        },
        start: {},
      },
      logPath,
    )
    const runtime = new VmRuntime({
      limactlPath,
      limaHome,
      browserosRoot: root,
      arch: 'arm64',
    })
    socketServer = await createSocket(getLimaSocketPath(root))

    await runtime.ensureReady()

    const log = await readFile(logPath, 'utf8')
    expect(log).toContain(`ARGS:start --tty=false ${VM_NAME}`)
    expect(log).not.toContain('ARGS:create')
  })

  it('treats stopVm as idempotent when the VM is already stopped', async () => {
    const limactlPath = await fakeLimactl(
      { stop: { stderr: 'instance is not running', exit: 1 } },
      logPath,
    )
    const runtime = new VmRuntime({
      limactlPath,
      limaHome,
      browserosRoot: root,
    })

    await expect(runtime.stopVm()).resolves.toBeUndefined()
  })

  it('points at cache sync when the compressed disk is missing', async () => {
    await rm(compressedDiskPath(manifest.vmVersion, 'arm64', root))
    const limactlPath = await fakeLimactl({ list: { stdout: '' } }, logPath)
    const runtime = new VmRuntime({
      limactlPath,
      limaHome,
      browserosRoot: root,
      arch: 'arm64',
    })

    await expect(runtime.ensureReady()).rejects.toThrow('bun run cache:sync')
  })

  it('throws VmNotReadyError when the socket never appears', async () => {
    const limactlPath = await fakeLimactl(
      { list: { stdout: '' }, create: {}, start: {} },
      logPath,
    )
    const runtime = new VmRuntime({
      limactlPath,
      limaHome,
      browserosRoot: root,
      arch: 'arm64',
      socketTimeoutMs: 10,
      socketPollMs: 1,
      decompressDisk: async (_from, to) => {
        await writeFile(to, 'qcow2')
      },
    })

    await expect(runtime.ensureReady()).rejects.toThrow(VmNotReadyError)
  })

  it('exposes a reset stub with a follow-up-plan message', async () => {
    const limactlPath = await fakeLimactl({}, logPath)
    const runtime = new VmRuntime({
      limactlPath,
      limaHome,
      browserosRoot: root,
    })

    await expect(runtime.reset('bad disk')).rejects.toThrow(
      'VmRuntime.reset is not implemented yet',
    )
  })

  it('logs version mismatch and keeps using the existing VM', async () => {
    await writeInstalledManifest(root, '2026.04.21')
    const limactlPath = await fakeLimactl(
      {
        list: {
          stdout: JSON.stringify([
            { name: VM_NAME, status: 'Running', dir: limaHome },
          ]),
        },
      },
      logPath,
    )
    const runtime = new VmRuntime({
      limactlPath,
      limaHome,
      browserosRoot: root,
      arch: 'arm64',
    })
    socketServer = await createSocket(getLimaSocketPath(root))
    const originalWarn = logger.warn
    const warnings: Array<{
      message: string
      meta?: Record<string, unknown>
    }> = []
    logger.warn = (message, meta) => warnings.push({ message, meta })

    try {
      await runtime.ensureReady()
    } finally {
      logger.warn = originalWarn
    }

    expect(warnings).toContainEqual({
      message: VM_TELEMETRY_EVENTS.upgradeDetected,
      meta: { from: '2026.04.21', to: '2026.04.22' },
    })
    await expect(
      readFile(getInstalledManifestPath(root), 'utf8'),
    ).resolves.toContain('2026.04.22')
  })

  it('does not auto-reset when socket readiness fails', async () => {
    const limactlPath = await fakeLimactl(
      { list: { stdout: '' }, create: {}, start: {} },
      logPath,
    )
    const runtime = new VmRuntime({
      limactlPath,
      limaHome,
      browserosRoot: root,
      arch: 'arm64',
      socketTimeoutMs: 10,
      socketPollMs: 1,
      decompressDisk: async (_from, to) => {
        await writeFile(to, 'qcow2')
      },
    })
    let resetCalled = false
    runtime.reset = async () => {
      resetCalled = true
      throw new Error('reset called')
    }

    await expect(runtime.ensureReady()).rejects.toThrow(VmNotReadyError)
    expect(resetCalled).toBe(false)
  })

  it('delegates runCommand and listRunningContainers through limactl shell', async () => {
    const limactlPath = await fakeLimactl(
      { shell: { stdout: 'gateway\nworker\n' } },
      logPath,
    )
    const runtime = new VmRuntime({
      limactlPath,
      limaHome,
      browserosRoot: root,
    })

    await expect(runtime.runCommand(['podman', 'version'])).resolves.toBe(0)
    await expect(runtime.listRunningContainers()).resolves.toEqual([
      'gateway',
      'worker',
    ])

    const log = await readFile(logPath, 'utf8')
    expect(log).toContain(`ARGS:shell ${VM_NAME} -- podman version`)
    expect(log).toContain(
      `ARGS:shell ${VM_NAME} -- podman ps --format {{.Names}}`,
    )
  })

  it('returns a stop handle for tailing container logs', async () => {
    const limactlPath = await fakeLimactl(
      { shell: { stdout: 'line\n' } },
      logPath,
    )
    const runtime = new VmRuntime({
      limactlPath,
      limaHome,
      browserosRoot: root,
    })
    const lines: string[] = []

    const stop = runtime.tailContainerLogs('gateway', (line) =>
      lines.push(line),
    )
    await Bun.sleep(20)
    stop()

    expect(lines).toEqual(['line'])
    await expect(readFile(logPath, 'utf8')).resolves.toContain(
      `ARGS:shell ${VM_NAME} -- podman logs -f --tail 0 gateway`,
    )
  })
})

async function writeCachedManifest(root: string): Promise<void> {
  const manifestPath = getCachedManifestPath(root)
  await mkdir(dirname(manifestPath), { recursive: true })
  await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`)
}

async function writeInstalledManifest(
  root: string,
  vmVersion = manifest.vmVersion,
): Promise<void> {
  const manifestPath = getInstalledManifestPath(root)
  await mkdir(dirname(manifestPath), { recursive: true })
  await writeFile(
    manifestPath,
    `${JSON.stringify({ ...manifest, vmVersion })}\n`,
  )
}

async function createSocket(
  path: string,
): Promise<ReturnType<typeof Bun.listen>> {
  await mkdir(dirname(path), { recursive: true })
  return Bun.listen({
    unix: path,
    socket: {
      data() {},
    },
  })
}
