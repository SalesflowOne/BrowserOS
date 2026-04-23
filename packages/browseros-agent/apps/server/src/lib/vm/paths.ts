/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { existsSync } from 'node:fs'
import { homedir, arch as osArch } from 'node:os'
import { isAbsolute, join, relative, sep } from 'node:path'
import { PATHS } from '@browseros/shared/constants/paths'

export const VM_NAME = 'browseros-vm'
export const GUEST_VM_STATE = '/mnt/browseros/vm'
export const GUEST_IMAGE_CACHE = '/mnt/browseros/cache/images'

export type Arch = 'arm64' | 'x64'

function rootDir(): string {
  const base =
    process.env.NODE_ENV === 'development'
      ? PATHS.DEV_BROWSEROS_DIR_NAME
      : PATHS.BROWSEROS_DIR_NAME
  return join(homedir(), base)
}

export function detectArch(arch: NodeJS.Architecture = osArch()): Arch {
  if (arch === 'arm64') return 'arm64'
  if (arch === 'x64') return 'x64'
  throw new Error(`unsupported host arch: ${arch}`)
}

export function getLimaHomeDir(browserosRoot = rootDir()): string {
  return join(browserosRoot, 'lima')
}

export function getVmStateDir(browserosRoot = rootDir()): string {
  return join(browserosRoot, 'vm')
}

export function getVmCacheDir(browserosRoot = rootDir()): string {
  return join(browserosRoot, PATHS.CACHE_DIR_NAME, 'vm')
}

export function getImageCacheDir(browserosRoot = rootDir()): string {
  return join(getVmCacheDir(browserosRoot), 'images')
}

export function getCachedManifestPath(browserosRoot = rootDir()): string {
  return join(getVmCacheDir(browserosRoot), 'manifest.json')
}

export function getInstalledManifestPath(browserosRoot = rootDir()): string {
  return join(getVmStateDir(browserosRoot), 'manifest.json')
}

export function getLimaSocketPath(browserosRoot = rootDir()): string {
  return join(getLimaHomeDir(browserosRoot), VM_NAME, 'sock', 'podman.sock')
}

export function compressedDiskPath(
  version: string,
  arch: Arch,
  browserosRoot = rootDir(),
): string {
  return join(
    getVmCacheDir(browserosRoot),
    `browseros-vm-${version}-${arch}.qcow2.zst`,
  )
}

export function decompressedDiskPath(
  version: string,
  arch: Arch,
  browserosRoot = rootDir(),
): string {
  return join(
    getVmCacheDir(browserosRoot),
    `browseros-vm-${version}-${arch}.qcow2`,
  )
}

export function resolveBundledLimactl(resourcesDir: string): string {
  if (process.env.NODE_ENV === 'development') return 'limactl'

  const candidate = join(
    resourcesDir,
    'bin',
    'third_party',
    'podman',
    'limactl',
  )
  if (!existsSync(candidate)) {
    throw new Error(
      `bundled limactl not found at ${candidate}; see the build-tools README and run bun run cache:sync`,
    )
  }
  return candidate
}

export function hostPathToGuest(
  hostPath: string,
  browserosRoot = rootDir(),
): string {
  const vmState = getVmStateDir(browserosRoot)
  const imageCache = getImageCacheDir(browserosRoot)
  const vmStateRelative = mountedRelativePath(vmState, hostPath)
  if (vmStateRelative !== null)
    return guestPath(GUEST_VM_STATE, vmStateRelative)

  const imageCacheRelative = mountedRelativePath(imageCache, hostPath)
  if (imageCacheRelative !== null) {
    return guestPath(GUEST_IMAGE_CACHE, imageCacheRelative)
  }

  throw new Error(`host path ${hostPath} is not under any known guest mount`)
}

function mountedRelativePath(parent: string, child: string): string | null {
  const path = relative(parent, child)
  if (path === '') return ''
  if (path.startsWith('..') || isAbsolute(path)) return null
  return path
}

function guestPath(root: string, relativePath: string): string {
  if (!relativePath) return root
  return `${root}/${relativePath.split(sep).join('/')}`
}
