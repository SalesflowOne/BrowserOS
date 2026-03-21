#!/usr/bin/env bun

import { mkdir } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import { BrowserOSAppManager } from '../../src/runner/browseros-app-manager'
import { loadTasks } from '../../src/runner/task-loader'
import { executeShowcaseTask } from './executor'
import { saveRunIndex } from './manifest'
import type { ShowcaseRunIndex } from './types'
import { uploadShowcase } from './uploader'

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    tasks: { type: 'string', short: 't' },
    output: { type: 'string', short: 'o', default: './showcase-output' },
    model: { type: 'string', short: 'm', default: 'gpt-4o' },
    provider: { type: 'string', short: 'p', default: 'openai' },
    'api-key-env': { type: 'string', default: 'OPENAI_API_KEY' },
    'cdp-port': { type: 'string' },
    timeout: { type: 'string', default: '300000' },
    upload: { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h' },
  },
})

if (values.help || !values.tasks) {
  console.log(`
Showcase Dataset Generator

Runs the BrowserOS agent on tasks and captures before/after screenshots
with crosshair annotations for element-targeting tool calls.

Usage:
  bun scripts/showcase/generate.ts --tasks <path> [options]

Options:
  -t, --tasks <path>       JSONL task file (required)
  -o, --output <dir>       Output directory (default: ./showcase-output)
  -m, --model <model>      LLM model (default: gpt-4o)
  -p, --provider <name>    LLM provider (default: openai)
  --api-key-env <var>      Env var for API key (default: OPENAI_API_KEY)
  --cdp-port <port>        Connect to existing Chrome (skips BrowserOS launch)
  --timeout <ms>           Per-task timeout in ms (default: 300000)
  --upload                 Upload results to R2 after generation
  -h, --help               Show this help
`)
  process.exit(values.help ? 0 : 1)
}

const config = {
  tasks: values.tasks as string,
  output: (values.output ?? './showcase-output') as string,
  model: (values.model ?? 'gpt-4o') as string,
  provider: (values.provider ?? 'openai') as string,
  apiKeyEnv: (values['api-key-env'] ?? 'OPENAI_API_KEY') as string,
  cdpPort: values['cdp-port'] ? Number(values['cdp-port']) : undefined,
  timeout: Number(values.timeout ?? '300000'),
  upload: values.upload ?? false,
}

const apiKey = process.env[config.apiKeyEnv]
if (!apiKey) {
  console.error(`Missing API key: set ${config.apiKeyEnv} environment variable`)
  process.exit(1)
}

const { tasks } = await loadTasks({ type: 'file', path: config.tasks })
console.log(`Loaded ${tasks.length} task(s)`)

await mkdir(config.output, { recursive: true })

let appManager: BrowserOSAppManager | null = null
let cdpPort = config.cdpPort ?? 9222

if (!config.cdpPort) {
  appManager = new BrowserOSAppManager(0, {
    cdp: 9010,
    server: 9110,
    extension: 9310,
  })
  console.log('Starting BrowserOS...')
  await appManager.restart()
  cdpPort = 9010
}

const runId = `${new Date().toISOString().slice(0, 10)}-${crypto.randomUUID().slice(0, 8)}`
const runIndex: ShowcaseRunIndex = {
  runId,
  createdAt: new Date().toISOString(),
  agentConfig: { model: config.model, provider: config.provider },
  tasks: [],
}

console.log(`\nRun ID: ${runId}`)
console.log(`Output: ${config.output}\n`)

try {
  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i]
    console.log(`[${i + 1}/${tasks.length}] ${task.query_id}: ${task.query}`)

    // Restart browser between tasks for clean state
    if (appManager && i > 0) {
      await appManager.restart()
    }

    try {
      const { manifest, status } = await executeShowcaseTask(
        task,
        cdpPort,
        config.output,
        {
          model: config.model,
          provider: config.provider,
          apiKey,
        },
        config.timeout,
      )

      runIndex.tasks.push({
        executionId: manifest.executionId,
        taskId: task.query_id,
        query: task.query,
        stepCount: manifest.steps.length,
        status,
        manifestPath: `${manifest.executionId}/manifest.json`,
      })

      const duration = (manifest.totalDurationMs / 1000).toFixed(1)
      console.log(
        `  ${status.toUpperCase()} — ${manifest.steps.length} steps, ${duration}s\n`,
      )
    } catch (err) {
      console.error(
        `  FAILED — ${err instanceof Error ? err.message : String(err)}\n`,
      )
      runIndex.tasks.push({
        executionId: 'unknown',
        taskId: task.query_id,
        query: task.query,
        stepCount: 0,
        status: 'failed',
        manifestPath: '',
      })
    }
  }

  await saveRunIndex(config.output, runIndex)
  console.log(`\nResults saved to: ${config.output}`)
  console.log(
    `Tasks: ${runIndex.tasks.filter((t) => t.status === 'completed').length} completed, ` +
      `${runIndex.tasks.filter((t) => t.status === 'failed').length} failed, ` +
      `${runIndex.tasks.filter((t) => t.status === 'timeout').length} timed out`,
  )

  if (config.upload) {
    console.log('\nUploading to R2...')
    const baseUrl = await uploadShowcase(config.output, runId)
    console.log(`Uploaded to: ${baseUrl}`)
  }
} finally {
  if (appManager) {
    await appManager.killApp()
  }
}
