/**
 * @license
 * Copyright 2025 BrowserOS
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  configurePodmanRuntime,
  getPodmanRuntime,
  PodmanRuntime,
  readMachineResources,
  resolveBundledPodmanPath,
} from '../../../../src/api/services/openclaw/podman-runtime'

class FakePodmanRuntime extends PodmanRuntime {
  machineStatuses: Array<{ initialized: boolean; running: boolean }>
  initCalls = 0
  startCalls = 0
  statusCalls = 0

  constructor(statuses: Array<{ initialized: boolean; running: boolean }>) {
    super({ podmanPath: 'podman' })
    this.machineStatuses = [...statuses]
  }

  async getMachineStatus(): Promise<{
    initialized: boolean
    running: boolean
  }> {
    this.statusCalls += 1
    return (
      this.machineStatuses.shift() ?? {
        initialized: true,
        running: true,
      }
    )
  }

  async initMachine(): Promise<void> {
    this.initCalls += 1
  }

  async startMachine(): Promise<void> {
    this.startCalls += 1
  }
}

describe('podman runtime', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'browseros-podman-test-'))
  })

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
    configurePodmanRuntime({ podmanPath: 'podman' })
  })

  it('returns the bundled podman path when the executable exists', () => {
    const bundledPath = path.join(
      tempDir,
      'bin',
      'third_party',
      'podman',
      'podman',
    )
    fs.mkdirSync(path.dirname(bundledPath), { recursive: true })
    fs.writeFileSync(bundledPath, 'podman')

    expect(resolveBundledPodmanPath(tempDir, 'darwin')).toBe(bundledPath)
  })

  it('uses the windows executable name for bundled podman', () => {
    const bundledPath = path.join(
      tempDir,
      'bin',
      'third_party',
      'podman',
      'podman.exe',
    )
    fs.mkdirSync(path.dirname(bundledPath), { recursive: true })
    fs.writeFileSync(bundledPath, 'podman')

    expect(resolveBundledPodmanPath(tempDir, 'win32')).toBe(bundledPath)
  })

  it('returns null when no bundled podman executable exists', () => {
    expect(resolveBundledPodmanPath(tempDir, 'darwin')).toBeNull()
  })

  it('configures the runtime to prefer the bundled podman path', () => {
    const bundledPath = path.join(
      tempDir,
      'bin',
      'third_party',
      'podman',
      'podman',
    )
    fs.mkdirSync(path.dirname(bundledPath), { recursive: true })
    fs.writeFileSync(bundledPath, 'podman')

    const runtime = configurePodmanRuntime({ resourcesDir: tempDir })

    expect(runtime.getPodmanPath()).toBe(bundledPath)
    expect(getPodmanRuntime().getPodmanPath()).toBe(bundledPath)
  })

  it('falls back to PATH podman when no bundled executable is present', () => {
    const runtime = configurePodmanRuntime({ resourcesDir: tempDir })

    expect(runtime.getPodmanPath()).toBe('podman')
  })

  it('ensureReady re-checks machine status on every call', async () => {
    const runtime = new FakePodmanRuntime([
      { initialized: true, running: true },
      { initialized: true, running: true },
      { initialized: true, running: true },
    ])

    await runtime.ensureReady()
    await runtime.ensureReady()
    await runtime.ensureReady()

    expect(runtime.statusCalls).toBe(3)
    expect(runtime.initCalls).toBe(0)
    expect(runtime.startCalls).toBe(0)
  })

  it('ensureReady initializes when machine is not present', async () => {
    const runtime = new FakePodmanRuntime([
      { initialized: false, running: false },
    ])

    await runtime.ensureReady()

    expect(runtime.statusCalls).toBe(1)
    expect(runtime.initCalls).toBe(1)
    expect(runtime.startCalls).toBe(1)
  })

  it('ensureReady starts when machine is initialized but stopped', async () => {
    const runtime = new FakePodmanRuntime([
      { initialized: true, running: false },
    ])

    await runtime.ensureReady()

    expect(runtime.initCalls).toBe(0)
    expect(runtime.startCalls).toBe(1)
  })

  it('ensureReady detects an externally stopped machine on the next call', async () => {
    const runtime = new FakePodmanRuntime([
      { initialized: true, running: true },
      { initialized: true, running: false },
    ])

    await runtime.ensureReady()
    await runtime.ensureReady()

    expect(runtime.statusCalls).toBe(2)
    expect(runtime.startCalls).toBe(1)
  })
})

describe('readMachineResources', () => {
  const ORIGINAL_CPUS = process.env.BROWSEROS_PODMAN_CPUS
  const ORIGINAL_MEMORY = process.env.BROWSEROS_PODMAN_MEMORY_MB

  afterEach(() => {
    restoreEnv('BROWSEROS_PODMAN_CPUS', ORIGINAL_CPUS)
    restoreEnv('BROWSEROS_PODMAN_MEMORY_MB', ORIGINAL_MEMORY)
  })

  it('returns defaults when env vars are unset', () => {
    delete process.env.BROWSEROS_PODMAN_CPUS
    delete process.env.BROWSEROS_PODMAN_MEMORY_MB

    expect(readMachineResources()).toEqual({ cpus: 4, memoryMb: 4096 })
  })

  it('parses valid env values', () => {
    process.env.BROWSEROS_PODMAN_CPUS = '6'
    process.env.BROWSEROS_PODMAN_MEMORY_MB = '8192'

    expect(readMachineResources()).toEqual({ cpus: 6, memoryMb: 8192 })
  })

  it('falls back to defaults for non-numeric input', () => {
    process.env.BROWSEROS_PODMAN_CPUS = 'abc'
    process.env.BROWSEROS_PODMAN_MEMORY_MB = ''

    expect(readMachineResources()).toEqual({ cpus: 4, memoryMb: 4096 })
  })

  it('falls back to defaults for zero and negative values', () => {
    process.env.BROWSEROS_PODMAN_CPUS = '0'
    process.env.BROWSEROS_PODMAN_MEMORY_MB = '-512'

    expect(readMachineResources()).toEqual({ cpus: 4, memoryMb: 4096 })
  })
})

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key]
  else process.env[key] = value
}
