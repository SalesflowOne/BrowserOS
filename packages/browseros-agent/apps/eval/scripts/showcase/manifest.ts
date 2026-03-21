import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  ShowcaseRunIndex,
  ShowcaseStep,
  ShowcaseTaskManifest,
} from './types'

export function buildTaskManifest(opts: {
  executionId: string
  taskId: string
  query: string
  startUrl: string
  dataset: string
  steps: ShowcaseStep[]
  finalAnswer: string | null
  model: string
  provider: string
  totalDurationMs: number
}): ShowcaseTaskManifest {
  return {
    executionId: opts.executionId,
    taskId: opts.taskId,
    query: opts.query,
    startUrl: opts.startUrl,
    dataset: opts.dataset,
    steps: opts.steps,
    finalAnswer: opts.finalAnswer,
    agentConfig: { model: opts.model, provider: opts.provider },
    totalDurationMs: opts.totalDurationMs,
    createdAt: new Date().toISOString(),
  }
}

export async function saveTaskManifest(
  outputDir: string,
  executionId: string,
  manifest: ShowcaseTaskManifest,
): Promise<string> {
  const manifestPath = join(outputDir, executionId, 'manifest.json')
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2))
  return manifestPath
}

export async function saveRunIndex(
  outputDir: string,
  index: ShowcaseRunIndex,
): Promise<string> {
  const indexPath = join(outputDir, 'index.json')
  await writeFile(indexPath, JSON.stringify(index, null, 2))
  return indexPath
}
