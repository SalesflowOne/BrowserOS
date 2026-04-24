/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { createHash } from 'node:crypto'
import { createReadStream, existsSync } from 'node:fs'
import { mkdir, readFile, rename, rm } from 'node:fs/promises'
import { arch as hostArch } from 'node:os'
import { dirname, join } from 'node:path'
import type { VmArtifact, VmManifest } from './manifest'
import type { Arch } from './paths'
import { getCachedManifestPath } from './paths'

const DEFAULT_CDN_BASE_URL = 'https://cdn.browseros.com'
const DEFAULT_TIMEOUT_MS = 30_000
const ARCHES: Arch[] = ['arm64', 'x64']

export interface VmCacheSyncOptions {
  browserosRoot?: string
  cdnBaseUrl?: string
  manifestUrl?: string
  allArches?: boolean
  fetchImpl?: typeof fetch
  rawHostArch?: NodeJS.Architecture
  timeoutMs?: number
}

export interface VmCacheSyncResult {
  downloaded: string[]
  manifestPath: string
  skipped: boolean
}

let inFlight: Promise<VmCacheSyncResult> | null = null

export function prefetchVmCache(
  options: VmCacheSyncOptions = {},
): Promise<VmCacheSyncResult> {
  return startOrReuseSync(options)
}

export function ensureVmCacheSynced(
  options: VmCacheSyncOptions = {},
): Promise<VmCacheSyncResult> {
  return startOrReuseSync(options)
}

export async function ensureVmCacheAvailable(
  options: VmCacheSyncOptions = {},
): Promise<void> {
  if (inFlight) {
    await inFlight
  }

  if (existsSync(getCachedManifestPath(options.browserosRoot))) return

  await ensureVmCacheSynced(options)
}

function startOrReuseSync(
  options: VmCacheSyncOptions,
): Promise<VmCacheSyncResult> {
  if (inFlight) return inFlight
  inFlight = syncVmCache(options).finally(() => {
    inFlight = null
  })
  return inFlight
}

async function syncVmCache(
  options: VmCacheSyncOptions,
): Promise<VmCacheSyncResult> {
  const cfg = resolveSyncConfig(options)
  const remote = await fetchManifest(cfg)
  const manifestPath = getCachedManifestPath(cfg.browserosRoot)
  const local = await readLocalManifest(manifestPath)
  const plan = planDownloads({
    remote,
    local,
    cacheRoot: cacheRootForManifest(manifestPath),
    arches: cfg.arches,
  })

  for (const item of plan) {
    await downloadArtifact(
      cfg.fetchImpl,
      joinUrl(cfg.cdnBaseUrl, item.key),
      item.destPath,
      item.sha256,
      cfg.timeoutMs,
    )
  }

  await mkdir(dirname(manifestPath), { recursive: true })
  const tempPath = `${manifestPath}.${process.pid}.${Date.now()}.tmp`
  await Bun.write(tempPath, `${JSON.stringify(remote, null, 2)}\n`)
  await rename(tempPath, manifestPath)

  return {
    downloaded: plan.map((item) => item.key),
    manifestPath,
    skipped: plan.length === 0,
  }
}

interface SyncConfig {
  browserosRoot?: string
  cdnBaseUrl: string
  manifestUrl: string
  fetchImpl: typeof fetch
  arches: Arch[]
  timeoutMs: number
}

function resolveSyncConfig(options: VmCacheSyncOptions): SyncConfig {
  const cdnBaseUrl =
    trimNonEmpty(options.cdnBaseUrl) ??
    trimNonEmpty(process.env.BROWSEROS_VM_CACHE_CDN_BASE_URL) ??
    DEFAULT_CDN_BASE_URL
  return {
    browserosRoot: options.browserosRoot,
    cdnBaseUrl,
    manifestUrl:
      trimNonEmpty(options.manifestUrl) ??
      trimNonEmpty(process.env.BROWSEROS_VM_CACHE_MANIFEST_URL) ??
      joinUrl(cdnBaseUrl, 'vm/manifest.json'),
    fetchImpl: options.fetchImpl ?? fetch,
    arches: selectSyncArches(options),
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  }
}

async function fetchManifest(cfg: SyncConfig): Promise<VmManifest> {
  const response = await fetchWithTimeout(
    cfg.fetchImpl,
    cfg.manifestUrl,
    cfg.timeoutMs,
  )
  if (!response.ok) {
    throw new Error(
      `manifest fetch failed: ${cfg.manifestUrl} (${response.status})`,
    )
  }
  return (await response.json()) as VmManifest
}

interface DownloadPlanItem {
  key: string
  destPath: string
  sha256: string
}

function planDownloads(opts: {
  remote: VmManifest
  local: VmManifest | null
  cacheRoot: string
  arches: Arch[]
}): DownloadPlanItem[] {
  const out: DownloadPlanItem[] = []
  for (const arch of opts.arches) {
    for (const [name, agent] of Object.entries(opts.remote.agents)) {
      const remote = agent.tarballs[arch]
      if (!remote) continue
      const destPath = join(opts.cacheRoot, remote.key)
      if (
        !needsDownload(
          remote,
          opts.local?.agents[name]?.tarballs[arch],
          destPath,
        )
      ) {
        continue
      }
      out.push({ key: remote.key, destPath, sha256: remote.sha256 })
    }
  }
  return out
}

function needsDownload(
  remote: VmArtifact,
  local: VmArtifact | undefined,
  destPath: string,
): boolean {
  if (!existsSync(destPath)) return true
  return local?.sha256 !== remote.sha256
}

async function downloadArtifact(
  fetchImpl: typeof fetch,
  url: string,
  destPath: string,
  sha256: string,
  timeoutMs: number,
): Promise<void> {
  const partialPath = `${destPath}.partial`
  await mkdir(dirname(destPath), { recursive: true })
  await rm(partialPath, { force: true })

  const response = await fetchWithTimeout(fetchImpl, url, timeoutMs)
  if (!response.ok || !response.body) {
    throw new Error(`download failed: ${url} (${response.status})`)
  }

  const sink = Bun.file(partialPath).writer()
  const reader = response.body.getReader()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      sink.write(value)
    }
  } finally {
    await sink.end()
  }

  await verifySha256(partialPath, sha256)
  await rename(partialPath, destPath)
}

async function fetchWithTimeout(
  fetchImpl: typeof fetch,
  url: string,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetchImpl(url, { signal: controller.signal })
  } catch (error) {
    if ((error as { name?: string }).name === 'AbortError') {
      throw new Error(`fetch timed out after ${timeoutMs}ms: ${url}`)
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}

async function verifySha256(path: string, expected: string): Promise<void> {
  const actual = await sha256File(path)
  if (actual !== expected) {
    throw new Error(
      `sha256 mismatch for ${path}: expected ${expected}, got ${actual}`,
    )
  }
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk)
  }
  return hash.digest('hex')
}

async function readLocalManifest(path: string): Promise<VmManifest | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as VmManifest
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

function selectSyncArches(options: VmCacheSyncOptions): Arch[] {
  if (options.allArches) return [...ARCHES]
  const rawArch = options.rawHostArch ?? hostArch()
  if (rawArch === 'arm64') return ['arm64']
  if (rawArch === 'x64' || rawArch === 'ia32') return ['x64']
  throw new Error(`unsupported host arch: ${rawArch}`)
}

function cacheRootForManifest(manifestPath: string): string {
  return dirname(dirname(manifestPath))
}

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`
}

function trimNonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}
