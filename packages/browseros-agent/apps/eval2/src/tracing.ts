import { getTracer, Laminar, observe } from '@lmnr-ai/lmnr'
import type { TelemetrySettings } from 'ai'
import type { BenchmarkConfig } from './benchmark-config'
import type { Task } from './types'

let initialized = false

export function initTracing(config: BenchmarkConfig): void {
  if (!config.laminar.enabled) {
    console.log('Laminar tracing disabled in config')
    return
  }

  const apiKey = process.env.LMNR_PROJECT_API_KEY
  if (!apiKey) {
    console.warn('LMNR_PROJECT_API_KEY not set - running without tracing')
    return
  }

  try {
    Laminar.initialize({
      projectApiKey: apiKey,
      disableBatch: true,
      forceHttp: true,
      instrumentModules: {},
    })
    initialized = true
    console.log(
      `Laminar tracing enabled (session prefix: ${config.laminar.sessionPrefix})`,
    )
  } catch (error) {
    initialized = false
    console.warn(
      `Laminar initialization failed - running without tracing: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

export function isTracingEnabled(): boolean {
  return initialized
}

export function getTaskSessionId(
  task: Task,
  config: BenchmarkConfig,
  runId?: string,
): string | null {
  if (!initialized) {
    return null
  }

  const prefix = `${config.laminar.sessionPrefix}-`
  const taskId = task.queryId.startsWith(prefix)
    ? task.queryId.slice(prefix.length)
    : task.queryId
  return runId
    ? `${runId}-${taskId}`
    : `${config.laminar.sessionPrefix}-${taskId}`
}

export function getAiSdkTelemetry(
  task: Task,
  config: BenchmarkConfig,
  runId: string,
  conversationId: string,
): TelemetrySettings | undefined {
  if (!initialized) {
    return undefined
  }

  return {
    isEnabled: true,
    tracer: getTracer(),
    functionId: 'browseros.eval2.agent',
    metadata: {
      runId,
      taskId: task.queryId,
      dataset: task.dataset,
      model: config.model,
      conversationId,
    },
  }
}

export async function withTaskTrace<T>(
  task: Task,
  config: BenchmarkConfig,
  runId: string,
  fn: () => Promise<T>,
): Promise<T> {
  if (!initialized) {
    return await fn()
  }

  return await observe(
    {
      name: 'eval.task',
      sessionId: getTaskSessionId(task, config, runId) ?? task.queryId,
      spanType: 'EXECUTOR',
      metadata: {
        runId,
        taskId: task.queryId,
        dataset: task.dataset,
        model: config.model,
      },
      input: {
        query: task.query,
        startUrl: task.startUrl,
      },
    },
    fn,
  )
}

export async function flushTracing(): Promise<void> {
  if (!initialized) {
    return
  }

  try {
    await Laminar.flush()
  } catch (error) {
    console.warn(
      `Laminar flush failed: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}
