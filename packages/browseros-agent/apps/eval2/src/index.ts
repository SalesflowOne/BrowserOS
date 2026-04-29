import { parseArgs } from 'node:util'
import { runEval } from './eval-runner'

const HELP = `
eval2 - Langfuse-traced eval runner

Usage:
  bun run eval --config <path-to-config.jsonc>

Options:
  -c, --config <path>   Path to a benchmark config JSONC file (required)
  -h, --help            Show this help

Examples:
  bun run eval --config benchmark-configs/agisdk-smoke.jsonc
`

export async function main(): Promise<void> {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      config: { type: 'string', short: 'c' },
      help: { type: 'boolean', short: 'h' },
    },
  })

  if (values.help) {
    console.log(HELP)
    process.exit(0)
  }

  if (!values.config) {
    console.log(HELP)
    process.exit(1)
  }

  try {
    await runEval(values.config)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}

await main()
