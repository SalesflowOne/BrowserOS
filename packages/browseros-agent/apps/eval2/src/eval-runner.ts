import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { z } from 'zod'
import { AgisdkStateDiffGrader } from './agisdk-grader'
import { type BenchmarkConfig, loadBenchmarkConfig } from './benchmark-config'
import { BrowserOSAppManager } from './browseros-app-manager'
import { SingleAgent } from './single-agent'
import { flushTracing, getTaskSessionId, initTracing } from './tracing'
import {
  type GraderResult,
  type RawTask,
  RawTaskSchema,
  type RunSummary,
  type Task,
  type TaskResult,
} from './types'

const RawTaskArraySchema = z.array(RawTaskSchema)

function parseJsonlTasks(raw: string): RawTask[] {
  const trimmed = raw.trim()
  if (!trimmed) {
    return []
  }

  if (trimmed.startsWith('[')) {
    return RawTaskArraySchema.parse(JSON.parse(trimmed))
  }

  return trimmed
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line, index) => {
      try {
        return RawTaskSchema.parse(JSON.parse(line))
      } catch (error) {
        throw new Error(
          `Invalid dataset JSONL on line ${index + 1}: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    })
}

async function loadTasks(
  datasetPath: string,
  maxTasks: number | undefined,
): Promise<{ tasks: Task[]; total: number }> {
  const raw = await readFile(datasetPath, 'utf-8')
  const entries = parseJsonlTasks(raw)
  const tasks = entries.map((entry) => ({
    queryId: entry.query_id,
    query: entry.query,
    dataset: entry.dataset,
    startUrl: entry.start_url,
  }))

  return {
    tasks: maxTasks ? tasks.slice(0, maxTasks) : tasks,
    total: tasks.length,
  }
}

function formatTimestamp(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hour = String(date.getHours()).padStart(2, '0')
  const minute = String(date.getMinutes()).padStart(2, '0')
  return `${year}-${month}-${day}-${hour}${minute}`
}

function buildSummary(
  config: BenchmarkConfig,
  runId: string,
  startedAt: Date,
  results: TaskResult[],
): RunSummary {
  const passed = results.filter((result) => result.status === 'PASS').length
  const failed = results.length - passed
  const passRate = results.length > 0 ? passed / results.length : 0
  const avgDurationMs =
    results.length > 0
      ? results.reduce((sum, result) => sum + result.durationMs, 0) /
        results.length
      : 0

  return {
    runId,
    configName: config.name,
    model: config.model,
    startedAt: startedAt.toISOString(),
    completedAt: new Date().toISOString(),
    total: results.length,
    passed,
    failed,
    passRate,
    avgDurationMs,
    tasks: results.map((result) => ({
      queryId: result.task.queryId,
      status: result.status,
      durationMs: result.durationMs,
      graderReward: result.graderResult.score,
      langfuseSessionId: getTaskSessionId(result.task, config, runId),
    })),
  }
}

function printSummary(summary: RunSummary): void {
  const separator = '='.repeat(60)
  console.log(`\n${separator}`)
  console.log('EVALUATION COMPLETE')
  console.log(
    `Total: ${summary.total} | Passed: ${summary.passed} | ` +
      `Failed: ${summary.failed} | Pass rate: ${(
        summary.passRate * 100
      ).toFixed(1)}% | Avg: ${(summary.avgDurationMs / 1000).toFixed(1)}s`,
  )
  console.log(separator)
}

function buildFailedTaskResult(
  task: Task,
  startedAtMs: number,
  reason: string,
): TaskResult {
  return {
    task,
    agentResult: {
      finalAnswer: null,
      messages: [],
      terminationReason: 'error',
      toolCallCount: 0,
    },
    graderResult: {
      score: 0,
      pass: false,
      reasoning: reason,
    },
    durationMs: Date.now() - startedAtMs,
    status: 'FAIL',
  }
}

export async function runEval(configPath: string): Promise<void> {
  const startedAt = new Date()
  const { config, configDir, datasetPath } =
    await loadBenchmarkConfig(configPath)
  const { tasks, total } = await loadTasks(datasetPath, config.maxTasks)
  const runId = `${config.name}-${formatTimestamp(startedAt)}`
  const outputDir = resolve(configDir, '..', 'results', runId)

  console.log(`Loaded config: ${configPath}`)
  console.log(
    `Dataset: ${tasks.length} tasks${
      config.maxTasks ? ` (capped from ${total})` : ''
    }`,
  )

  initTracing(config)
  await mkdir(outputDir, { recursive: true })

  const appManager = new BrowserOSAppManager(
    0,
    config.ports,
    false,
    false,
    config.browserosBinary,
  )
  const grader = new AgisdkStateDiffGrader()
  const results: TaskResult[] = []
  let agent: SingleAgent | null = null

  const onSignal = async (): Promise<void> => {
    console.log('\nShutting down...')
    await agent?.dispose().catch(() => {})
    await appManager.killApp()
    await flushTracing()
    process.exit(130)
  }
  process.on('SIGINT', onSignal)
  process.on('SIGTERM', onSignal)

  try {
    console.log(
      `[W0] Booting BrowserOS - CDP=${config.ports.cdp} Server=${config.ports.server} Extension=${config.ports.extension}`,
    )
    await appManager.restart()
    console.log('[W0] Chrome ready, Server healthy')

    agent = new SingleAgent({
      config,
      serverUrl: appManager.getServerUrl(),
      runId,
    })

    const activeAgent = agent

    for (const [index, task] of tasks.entries()) {
      const taskStart = Date.now()
      console.log(`\n[${index + 1}/${tasks.length}] ${task.queryId} starting`)

      // sessionId on AI SDK telemetry already groups all spans for this task;
      // no outer observe() wrapper needed
      const agentResult = await activeAgent
        .runTask(task)
        .catch((error: unknown) => {
          console.warn(
            `[${index + 1}/${tasks.length}] ${task.queryId}: agent crashed - ${
              error instanceof Error ? error.message : String(error)
            }`,
          )
          return null
        })

      if (!agentResult) {
        results.push(
          buildFailedTaskResult(task, taskStart, 'Agent crashed before result'),
        )
        await activeAgent.cleanup()
        continue
      }

      let graderResult: GraderResult
      try {
        graderResult = await grader.grade({
          task: {
            query_id: task.queryId,
            query: task.query,
            dataset: task.dataset,
          },
          messages: agentResult.messages,
          screenshotCount: 0,
          finalAnswer: agentResult.finalAnswer,
          outputDir: join(outputDir, task.queryId),
          mcpUrl: `${appManager.getServerUrl()}/mcp`,
        })
      } catch (error) {
        graderResult = {
          score: 0,
          pass: false,
          reasoning: `Grader crashed: ${error instanceof Error ? error.message : String(error)}`,
        }
      }

      const status: TaskResult['status'] = graderResult.pass ? 'PASS' : 'FAIL'
      const durationMs = Date.now() - taskStart
      console.log(
        `[${index + 1}/${tasks.length}] ${task.queryId}: ${status} (${(
          durationMs / 1000
        ).toFixed(1)}s)${
          graderResult.pass ? '' : ` - ${graderResult.reasoning}`
        }`,
      )

      results.push({ task, agentResult, graderResult, durationMs, status })
      await agent.cleanup()
    }
  } finally {
    process.off('SIGINT', onSignal)
    process.off('SIGTERM', onSignal)
    await agent?.dispose().catch(() => {})
    await appManager.killApp()
    await flushTracing()
  }

  const summary = buildSummary(config, runId, startedAt, results)
  const summaryPath = join(outputDir, 'summary.json')
  await writeFile(summaryPath, JSON.stringify(summary, null, 2))
  printSummary(summary)
  console.log(`Summary: ${summaryPath}`)
  if (summary.tasks.some((task) => task.langfuseSessionId)) {
    const baseUrl =
      process.env.LANGFUSE_BASE_URL ?? 'https://cloud.langfuse.com'
    console.log(`View traces: ${baseUrl}`)
  }
}
