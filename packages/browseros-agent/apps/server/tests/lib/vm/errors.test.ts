/**
 * @license
 * Copyright 2025 BrowserOS
 */

import { describe, expect, it } from 'bun:test'
import {
  ImageLoadError,
  LimaCommandError,
  ManifestMissingError,
  PodmanCommandError,
  VmError,
  VmNotReadyError,
  VmStateCorruptedError,
} from '../../../src/lib/vm/errors'
import { VM_TELEMETRY_EVENTS } from '../../../src/lib/vm/telemetry'

describe('VM errors', () => {
  it('keeps all VM domain errors under VmError', () => {
    const errors = [
      new VmError('base'),
      new VmNotReadyError('not ready'),
      new VmStateCorruptedError('corrupt'),
      new LimaCommandError('limactl start', 7, 'bad lima'),
      new PodmanCommandError('podman pull', 8, 'bad podman'),
      new ImageLoadError('openclaw:v1', 'bad image'),
      new ManifestMissingError('/tmp/manifest.json'),
    ]

    for (const error of errors) {
      expect(error).toBeInstanceOf(Error)
      expect(error).toBeInstanceOf(VmError)
    }
  })

  it('carries command failure details', () => {
    const lima = new LimaCommandError('limactl start', 12, 'stderr text')
    const podman = new PodmanCommandError('podman pull', 13, 'podman stderr')

    expect(lima.exitCode).toBe(12)
    expect(lima.stderr).toBe('stderr text')
    expect(podman.exitCode).toBe(13)
    expect(podman.stderr).toBe('podman stderr')
  })

  it('exports VM telemetry event names', () => {
    expect(Object.values(VM_TELEMETRY_EVENTS)).toEqual([
      'vm.ensure_ready.start',
      'vm.ensure_ready.ok',
      'vm.create',
      'vm.start',
      'vm.stop',
      'vm.upgrade.detected',
      'vm.upgrade.swap',
      'vm.upgrade.replay',
      'vm.reset.detected',
      'vm.reset.ok',
      'vm.socket_wait.timeout',
      'vm.manifest.missing',
      'vm.migration.openclaw_moved',
      'vm.migration.legacy_podman_detected',
    ])
  })
})
