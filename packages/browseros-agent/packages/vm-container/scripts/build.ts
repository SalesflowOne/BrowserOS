#!/usr/bin/env bun
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { buildDisk } from '../src/build/orchestrator'
import { parseArch, todayCalver } from '../src/schema/arch'

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    version: { type: 'string' },
    arch: { type: 'string' },
    'output-dir': { type: 'string', default: './dist' },
    'base-image-sha512': { type: 'string' },
  },
})

if (!values.arch) {
  console.error(
    'usage: bun run build -- --arch <arm64|x64> [--version <YYYY.MM.DD[-N]>] [--output-dir ./dist] [--base-image-sha512 <sha>]',
  )
  process.exit(1)
}

const version = values.version ?? todayCalver(Math.floor(Date.now() / 1000))

const result = await buildDisk({
  version,
  arch: parseArch(values.arch),
  outputDir: values['output-dir'] ?? './dist',
  baseImageSha512Override: values['base-image-sha512'],
})

const resultPath = path.join(
  values['output-dir'] ?? './dist',
  `build-result-${result.arch}.json`,
)
await writeFile(resultPath, JSON.stringify(result, null, 2))
console.log(JSON.stringify(result, null, 2))
