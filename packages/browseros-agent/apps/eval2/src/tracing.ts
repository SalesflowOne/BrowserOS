import { LangfuseMedia } from '@langfuse/core'
import { LangfuseSpanProcessor } from '@langfuse/otel'
import { startActiveObservation } from '@langfuse/tracing'
import { NodeSDK } from '@opentelemetry/sdk-node'
import type { TelemetrySettings } from 'ai'
import type { BenchmarkConfig } from './benchmark-config'
import type { Task } from './types'

let sdk: NodeSDK | null = null
let processor: LangfuseSpanProcessor | null = null
let initialized = false

export function initTracing(config: BenchmarkConfig): void {
  if (!config.langfuse.enabled) {
    console.log('Langfuse tracing disabled in config')
    return
  }
  // both keys required; warn and run untraced if either is missing
  const publicKey = process.env.LANGFUSE_PUBLIC_KEY
  const secretKey = process.env.LANGFUSE_SECRET_KEY
  if (!publicKey || !secretKey) {
    console.warn(
      'LANGFUSE_PUBLIC_KEY/LANGFUSE_SECRET_KEY not set - running without tracing',
    )
    return
  }

  try {
    processor = new LangfuseSpanProcessor({
      publicKey,
      secretKey,
      baseUrl: process.env.LANGFUSE_BASE_URL ?? 'https://cloud.langfuse.com',
      environment: process.env.NODE_ENV ?? 'development',
    })
    sdk = new NodeSDK({ spanProcessors: [processor] })
    sdk.start()
    initialized = true
    console.log(
      `Langfuse tracing enabled (session prefix: ${config.langfuse.sessionPrefix})`,
    )
  } catch (error) {
    initialized = false
    sdk = null
    processor = null
    console.warn(
      `Langfuse initialization failed - running without tracing: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
  }
}

export function isTracingEnabled(): boolean {
  return initialized
}

export function getTaskSessionId(
  task: Task,
  _config: BenchmarkConfig,
  runId: string,
): string {
  // sessionId groups all spans for one task; runId-prefixed so re-runs don't collide
  return `${runId}-${task.queryId}`
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
    functionId: 'browseros.eval2.agent',
    metadata: {
      sessionId: getTaskSessionId(task, config, runId),
      runId,
      taskId: task.queryId,
      dataset: task.dataset,
      model: config.model,
      conversationId,
    },
  }
}

export async function logScreenshot(
  toolName: string,
  pngBytes: Buffer,
  pageUrl: string | undefined,
): Promise<void> {
  if (!initialized) {
    return
  }
  // wrap PNG so Langfuse uploads it via presigned URL and renders it inline in the trace UI
  const media = new LangfuseMedia({
    source: 'bytes',
    contentBytes: pngBytes,
    contentType: 'image/png',
  })
  await startActiveObservation(`screenshot.${toolName}`, async (span) => {
    span.update({
      output: media,
      metadata: {
        toolName,
        pageUrl,
        bytes: pngBytes.length,
      },
    })
  })
}

export async function flushTracing(): Promise<void> {
  if (!initialized) {
    return
  }
  // forceFlush drains pending spans; shutdown also waits for pending media uploads
  try {
    await processor?.forceFlush()
    await sdk?.shutdown()
  } catch (error) {
    console.warn(
      `Langfuse flush failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
  } finally {
    initialized = false
    processor = null
    sdk = null
  }
}
