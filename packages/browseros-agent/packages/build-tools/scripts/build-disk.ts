#!/usr/bin/env bun
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import {
  copyFile,
  mkdir,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { $ } from 'bun'
import { type Arch, parseArch } from './common/arch'
import { qcow2Key } from './common/manifest'
import { sha256File } from './common/sha256'

type ChunkSink = ReturnType<ReturnType<typeof Bun.file>['writer']>

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    version: { type: 'string' },
    arch: { type: 'string' },
    'output-dir': { type: 'string', default: './dist' },
  },
})

if (!values.version || !values.arch) {
  console.error(
    'usage: build:disk -- --version <YYYY.MM.DD[-N]> --arch <arm64|x64> [--output-dir ./dist]',
  )
  process.exit(1)
}

const arch = parseArch(values.arch)
const version = values.version
const outDir = values['output-dir']
const pkgRoot = path.resolve(import.meta.dir, '..')

await mkdir(outDir, { recursive: true })

const baseImages = JSON.parse(
  await readFile(path.join(pkgRoot, 'recipe/base-images.json'), 'utf8'),
) as Record<Arch, { upstreamVersion: string; url: string; sha512: string }>
const base = baseImages[arch]
if (!base) throw new Error(`missing base image for arch ${arch}`)

const basePath = path.join(outDir, `base-${arch}.qcow2`)
await download(base.url, basePath)
await verifySha512(basePath, base.sha512)

const workPath = path.join(outDir, `work-${version}-${arch}.qcow2`)
await copyFile(basePath, workPath)

const buildMarkerPath = path.join(outDir, `build-marker-${arch}.json`)
await writeFile(
  buildMarkerPath,
  `${JSON.stringify({ name: 'browseros-vm', version, arch, phase: 'build' }, null, 2)}\n`,
)

const recipePath = path.join(pkgRoot, 'recipe/browseros-vm.recipe')
const recipeText = await readFile(recipePath, 'utf8')
const args = composeVirtCustomizeArgs({
  diskPath: workPath,
  recipeText,
  recipeDir: path.dirname(recipePath),
  substitutions: { version, manifest_tmp: buildMarkerPath },
})

await spawnChecked(['virt-customize', ...args])
await $`virt-sparsify --in-place ${workPath}`.quiet()

const rawOut = path.join(outDir, `browseros-vm-${version}-${arch}.qcow2`)
await $`qemu-img convert -O qcow2 -c ${workPath} ${rawOut}`.quiet()

const zstOut = `${rawOut}.zst`
await $`zstd -19 --long=30 -T0 -f -o ${zstOut} ${rawOut}`.quiet()

const sha = await sha256File(zstOut)
const size = (await stat(zstOut)).size
await writeFile(`${zstOut}.sha256`, `${sha}  ${path.basename(zstOut)}\n`)

await rm(workPath, { force: true })
await rm(basePath, { force: true })
await rm(rawOut, { force: true })
await rm(buildMarkerPath, { force: true })

console.log(
  JSON.stringify(
    {
      key: qcow2Key(version, arch),
      path: zstOut,
      sha256: sha,
      sizeBytes: size,
    },
    null,
    2,
  ),
)

function composeVirtCustomizeArgs(opts: {
  diskPath: string
  recipeText: string
  recipeDir: string
  substitutions: Record<string, string>
}): string[] {
  const out = ['-a', opts.diskPath]
  for (const rawLine of opts.recipeText.split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue

    const spaceAt = line.indexOf(' ')
    if (spaceAt === -1) throw new Error(`invalid recipe line: ${line}`)

    const op = line.slice(0, spaceAt)
    const rest = subst(line.slice(spaceAt + 1), opts.substitutions)

    if (op === 'run-command') {
      out.push('--run-command', rest)
      continue
    }

    if (op === 'copy-in') {
      const colonAt = rest.indexOf(':')
      if (colonAt === -1) throw new Error(`invalid copy-in line: ${line}`)
      const source = rest.slice(0, colonAt)
      const target = rest.slice(colonAt + 1)
      out.push('--copy-in', `${path.resolve(opts.recipeDir, source)}:${target}`)
      continue
    }

    if (op === 'write') {
      out.push('--write', rest)
      continue
    }

    if (op === 'truncate') {
      out.push('--truncate', rest)
      continue
    }

    throw new Error(`unknown recipe op: ${op}`)
  }
  return out
}

function subst(value: string, vars: Record<string, string>): string {
  return value.replace(/\{(\w+)\}/g, (_match, key: string) => {
    const replacement = vars[key]
    if (!replacement) throw new Error(`no substitution for {${key}}`)
    return replacement
  })
}

async function download(url: string, dest: string): Promise<void> {
  const response = await fetch(url)
  if (!response.ok || !response.body) {
    throw new Error(`download failed: ${url} (${response.status})`)
  }

  const sink = Bun.file(dest).writer()
  const reader = response.body.getReader()
  try {
    await pumpStream(reader, sink)
  } finally {
    await sink.end()
  }
}

async function verifySha512(filePath: string, expected: string): Promise<void> {
  const hash = createHash('sha512')
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk)
  }
  const actual = hash.digest('hex')
  if (actual !== expected) {
    throw new Error(
      `sha512 mismatch for ${filePath}: expected ${expected}, got ${actual}`,
    )
  }
}

async function spawnChecked(argv: string[]): Promise<void> {
  const proc = Bun.spawn(argv, {
    stdout: 'inherit',
    stderr: 'inherit',
    env: {
      ...process.env,
      LIBGUESTFS_BACKEND: process.env.LIBGUESTFS_BACKEND ?? 'direct',
    },
  })
  const code = await proc.exited
  if (code !== 0) throw new Error(`${argv[0]} exited ${code}`)
}

async function pumpStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  sink: ChunkSink,
): Promise<void> {
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    sink.write(value)
  }
}
