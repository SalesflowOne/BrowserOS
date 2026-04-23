/**
 * @license
 * Copyright 2025 BrowserOS
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { VmManifest } from '@browseros/build-tools/scripts/common/manifest'
import { ManifestMissingError } from '../../../src/lib/vm/errors'
import {
  agentForArch,
  compareVersions,
  readCachedManifest,
  readInstalledManifest,
  writeInstalledManifest,
} from '../../../src/lib/vm/manifest'

const manifest: VmManifest = {
  schemaVersion: 1,
  vmVersion: '2026.04.22',
  updatedAt: '2026-04-22T00:00:00.000Z',
  vmDisk: {
    arm64: {
      key: 'vm/browseros-vm-2026.04.22-arm64.qcow2.zst',
      sha256: 'a',
      sizeBytes: 1,
    },
    x64: {
      key: 'vm/browseros-vm-2026.04.22-x64.qcow2.zst',
      sha256: 'b',
      sizeBytes: 2,
    },
  },
  agents: {
    openclaw: {
      image: 'ghcr.io/openclaw/openclaw',
      version: '2026.4.12',
      tarballs: {
        arm64: {
          key: 'vm/images/openclaw-2026.4.12-arm64.tar.gz',
          sha256: 'c',
          sizeBytes: 3,
        },
        x64: {
          key: 'vm/images/openclaw-2026.4.12-x64.tar.gz',
          sha256: 'd',
          sizeBytes: 4,
        },
      },
    },
  },
}

describe('VM manifest helpers', () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'browseros-vm-manifest-'))
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('reads the cached manifest', async () => {
    const manifestPath = join(root, 'cache', 'vm', 'manifest.json')
    await mkdir(dirname(manifestPath), { recursive: true })
    await Bun.write(manifestPath, `${JSON.stringify(manifest)}\n`)

    await expect(readCachedManifest(root)).resolves.toEqual(manifest)
  })

  it('throws ManifestMissingError with a cache-sync hint when cached manifest is absent', async () => {
    await expect(readCachedManifest(root)).rejects.toThrow(ManifestMissingError)
    await expect(readCachedManifest(root)).rejects.toThrow('bun run cache:sync')
  })

  it('returns null for a missing installed manifest', async () => {
    await expect(readInstalledManifest(root)).resolves.toBeNull()
  })

  it('reads the installed manifest', async () => {
    const manifestPath = join(root, 'vm', 'manifest.json')
    await mkdir(dirname(manifestPath), { recursive: true })
    await Bun.write(manifestPath, `${JSON.stringify(manifest)}\n`)

    await expect(readInstalledManifest(root)).resolves.toEqual(manifest)
  })

  it('throws on malformed installed manifest JSON', async () => {
    const manifestPath = join(root, 'vm', 'manifest.json')
    await mkdir(dirname(manifestPath), { recursive: true })
    await Bun.write(manifestPath, '{not-json')

    await expect(readInstalledManifest(root)).rejects.toThrow()
  })

  it('writes the installed manifest atomically', async () => {
    await writeInstalledManifest(manifest, root)

    const raw = await readFile(join(root, 'vm', 'manifest.json'), 'utf8')
    expect(JSON.parse(raw)).toEqual(manifest)
  })

  it('compares installed and cached versions', () => {
    const older = { ...manifest, vmVersion: '2026.04.21' }
    const newer = { ...manifest, vmVersion: '2026.04.23' }

    expect(compareVersions(null, manifest)).toBe('fresh')
    expect(compareVersions(manifest, manifest)).toBe('same')
    expect(compareVersions(older, manifest)).toBe('upgrade')
    expect(compareVersions(newer, manifest)).toBe('downgrade')
  })

  it('returns the requested agent tarball for an arch', () => {
    expect(agentForArch(manifest, 'openclaw', 'arm64')).toEqual({
      image: 'ghcr.io/openclaw/openclaw',
      version: '2026.4.12',
      tarball: {
        key: 'vm/images/openclaw-2026.4.12-arm64.tar.gz',
        sha256: 'c',
        sizeBytes: 3,
      },
    })
  })

  it('throws when an agent or arch is absent', () => {
    expect(() => agentForArch(manifest, 'missing', 'arm64')).toThrow(
      'missing agent',
    )
    expect(() =>
      agentForArch(manifest, 'openclaw', 'x64' as never),
    ).not.toThrow()
  })
})
