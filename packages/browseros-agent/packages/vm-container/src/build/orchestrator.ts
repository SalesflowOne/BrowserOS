import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { copyFile, readFile, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { $ } from 'bun'
import type { Arch } from '../schema/arch'
import { assertCalver } from '../schema/arch'
import {
  type BaseImage,
  DEBIAN_BASE_IMAGES,
  debianSha512SumsUrl,
} from './base-image'
import {
  composeVirtCustomizeArgv,
  parsePackagesOutput,
  parseRecipe,
} from './recipe'
import type { BuildOptions, BuildResult } from './types'

const DEFAULT_RECIPE_REL = '../../recipe/browseros-vm.recipe'

const SHA512_HEX = /^[a-f0-9]{128}$/

// Bun's file writer type is mildly hostile to `ReadableStream.pipeTo`, so we
// hand-pump chunks through a lightweight sink type.
type ChunkSink = ReturnType<ReturnType<typeof Bun.file>['writer']>

export async function buildDisk(opts: BuildOptions): Promise<BuildResult> {
  assertCalver(opts.version)
  const base = DEBIAN_BASE_IMAGES[opts.arch]
  const pinnedSha512 =
    opts.baseImageSha512Override ??
    (await resolvePinnedSha512(base.upstreamVersion, base))

  const prepared = await prepareCustomizedDisk(opts, base, pinnedSha512)
  const finalized = await finalizeArtifacts(opts, prepared.workPath)
  await rm(prepared.workPath, { force: true })
  await rm(prepared.basePath, { force: true })

  return {
    arch: opts.arch,
    version: opts.version,
    baseImage: { ...base, sha512: pinnedSha512 },
    recipeSha256: prepared.recipeSha256,
    buildLogPath: prepared.buildLogPath,
    rawQcowPath: finalized.rawQcowPath,
    rawQcowSha256: finalized.rawQcowSha256,
    rawQcowSize: finalized.rawQcowSize,
    compressedPath: finalized.compressedPath,
    compressedSha256: finalized.compressedSha256,
    compressedSize: finalized.compressedSize,
    packages: finalized.packages,
  }
}

interface PreparedDisk {
  basePath: string
  workPath: string
  buildLogPath: string
  recipeSha256: string
}

async function prepareCustomizedDisk(
  opts: BuildOptions,
  base: BaseImage,
  pinnedSha512: string,
): Promise<PreparedDisk> {
  await $`mkdir -p ${opts.outputDir}`.quiet()
  const basePath = path.join(opts.outputDir, `base-${opts.arch}.qcow2`)
  await downloadTo(base.url, basePath)
  await verifySha512(basePath, pinnedSha512)

  const workPath = path.join(
    opts.outputDir,
    `work-${opts.version}-${opts.arch}.qcow2`,
  )
  await copyFile(basePath, workPath)

  const recipePath =
    opts.recipePath ?? path.resolve(import.meta.dir, DEFAULT_RECIPE_REL)
  const recipeText = await readFile(recipePath, 'utf8')
  const recipeSha256 = sha256String(recipeText)

  const buildMarkerPath = path.join(
    opts.outputDir,
    `build-marker-${opts.arch}.json`,
  )
  // The baked JSON is a build-time marker. The published per-version manifest
  // adds final provider hashes and URLs after artifact hashing and upload.
  await writeFile(
    buildMarkerPath,
    JSON.stringify(
      {
        name: 'browseros-vm',
        version: opts.version,
        arch: opts.arch,
        phase: 'build',
      },
      null,
      2,
    ),
  )

  const argv = composeVirtCustomizeArgv({
    diskPath: workPath,
    recipe: parseRecipe(recipeText),
    substitutions: { version: opts.version, manifest_tmp: buildMarkerPath },
    recipeDir: path.dirname(recipePath),
  })
  const buildLogPath = path.join(opts.outputDir, `build-${opts.arch}.log`)
  await spawnToLog(['virt-customize', ...argv], buildLogPath)
  await $`virt-sparsify --in-place ${workPath}`.quiet()

  return { basePath, workPath, buildLogPath, recipeSha256 }
}

interface FinalizedArtifacts {
  rawQcowPath: string
  rawQcowSha256: string
  rawQcowSize: number
  compressedPath: string
  compressedSha256: string
  compressedSize: number
  packages: Record<string, string>
}

async function finalizeArtifacts(
  opts: BuildOptions,
  workPath: string,
): Promise<FinalizedArtifacts> {
  const rawQcowPath = path.join(
    opts.outputDir,
    `browseros-vm-${opts.version}-${opts.arch}.qcow2`,
  )
  await $`qemu-img convert -O qcow2 -c ${workPath} ${rawQcowPath}`.quiet()
  const rawQcowSha256 = await sha256File(rawQcowPath)
  const rawQcowSize = (await stat(rawQcowPath)).size

  const compressedPath = `${rawQcowPath}.zst`
  await $`zstd -19 --long=30 -T0 -f -o ${compressedPath} ${rawQcowPath}`.quiet()
  const compressedSha256 = await sha256File(compressedPath)
  const compressedSize = (await stat(compressedPath)).size

  const packages = await readPackagesFromDisk(
    workPath,
    opts.outputDir,
    opts.arch,
  )

  return {
    rawQcowPath,
    rawQcowSha256,
    rawQcowSize,
    compressedPath,
    compressedSha256,
    compressedSize,
    packages,
  }
}

async function downloadTo(url: string, dest: string): Promise<void> {
  const response = await fetch(url)
  if (!response.ok || !response.body) {
    throw new Error(`download failed: ${url} (${response.status})`)
  }
  const sink = Bun.file(dest).writer()
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
}

async function verifySha512(filePath: string, expected: string): Promise<void> {
  const actual = await hashFile(filePath, 'sha512')
  if (actual !== expected) {
    throw new Error(
      `sha512 mismatch for ${filePath}: expected ${expected}, got ${actual}`,
    )
  }
}

async function sha256File(filePath: string): Promise<string> {
  return hashFile(filePath, 'sha256')
}

async function hashFile(
  filePath: string,
  algo: 'sha256' | 'sha512',
): Promise<string> {
  const hash = createHash(algo)
  for await (const chunk of createReadStream(filePath)) hash.update(chunk)
  return hash.digest('hex')
}

function sha256String(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

async function spawnToLog(argv: string[], logPath: string): Promise<void> {
  const log = Bun.file(logPath).writer()
  const proc = Bun.spawn(argv, {
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      ...process.env,
      LIBGUESTFS_BACKEND: process.env.LIBGUESTFS_BACKEND ?? 'direct',
    },
  })
  await Promise.all([
    pumpStream(proc.stdout, log),
    pumpStream(proc.stderr, log),
  ])
  const code = await proc.exited
  await log.end()
  if (code !== 0) {
    throw new Error(`${argv[0]} exited ${code}; see ${logPath}`)
  }
}

async function pumpStream(
  stream: ReadableStream<Uint8Array>,
  sink: ChunkSink,
): Promise<void> {
  const reader = stream.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    sink.write(value)
  }
}

async function readPackagesFromDisk(
  diskPath: string,
  outputDir: string,
  arch: Arch,
): Promise<Record<string, string>> {
  const dumpPath = path.join(outputDir, `pkgs-${arch}.txt`)
  await $`virt-copy-out -a ${diskPath} /var/lib/browseros-vm-pkg-versions ${outputDir}`.quiet()
  await $`mv ${outputDir}/browseros-vm-pkg-versions ${dumpPath}`.quiet()
  const text = await readFile(dumpPath, 'utf8')
  return parsePackagesOutput(text)
}

async function resolvePinnedSha512(
  upstreamVersion: string,
  base: BaseImage,
): Promise<string> {
  if (SHA512_HEX.test(base.sha512)) return base.sha512
  const sumsUrl = debianSha512SumsUrl(upstreamVersion)
  const response = await fetch(sumsUrl)
  if (!response.ok) throw new Error(`SHA512SUMS fetch failed: ${sumsUrl}`)
  const text = await response.text()
  const filename = base.url.slice(base.url.lastIndexOf('/') + 1)
  for (const line of text.split('\n')) {
    const [sha, name] = line.trim().split(/\s+/)
    if (name === filename && sha) return sha
  }
  throw new Error(`SHA512SUMS missing entry for ${filename}`)
}
