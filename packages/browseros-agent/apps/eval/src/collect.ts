#!/usr/bin/env bun

import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { runCollection } from './runner/collection-runner'

const HELP = `
VL training-data collector

Usage:
  bun run collect --seeds <path.jsonl> [options]

Options:
  --seeds <path>    JSONL file with CollectionTarget entries (required)
  --out <dir>       Output directory (default: results/vl-data/<timestamp>)
  --workers <n>     Parallel workers (default: 1)
  --limit <n>       Stop after N targets (default: all)
  --headless        Run BrowserOS headless (default: false)
  -h, --help        Show this help
`

async function main() {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      seeds: { type: 'string' },
      out: { type: 'string' },
      workers: { type: 'string', default: '1' },
      limit: { type: 'string' },
      headless: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  })

  if (values.help) {
    console.log(HELP)
    process.exit(0)
  }
  if (!values.seeds) {
    console.error('error: --seeds is required')
    console.log(HELP)
    process.exit(1)
  }

  const projectRoot = resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../../..',
  )
  const outDir = values.out
    ? resolve(process.cwd(), values.out)
    : resolve(projectRoot, `results/vl-data/${timestamp()}`)

  const { writtenCount, errors } = await runCollection({
    seedsPath: resolve(process.cwd(), values.seeds),
    outDir,
    projectRoot,
    workers: Number.parseInt(values.workers, 10),
    limit: values.limit ? Number.parseInt(values.limit, 10) : undefined,
    headless: values.headless,
  })

  console.log(`\nWrote ${writtenCount} record(s) to ${outDir}`)
  if (errors.length > 0) {
    console.error(`Validation failed with ${errors.length} error(s):`)
    for (const err of errors.slice(0, 20)) console.error(`  ${err}`)
    if (errors.length > 20)
      console.error(`  ... and ${errors.length - 20} more`)
    process.exit(1)
  }
  console.log('Validation passed.')
}

function timestamp(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})
