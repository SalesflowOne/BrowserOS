import type { GraderResult } from '../types'

export interface ViewerManifestTaskInput {
  queryId: string
  query: string
  startUrl?: string
  status: string
  durationMs: number
  screenshotCount: number
  graderResults: Record<string, GraderResult>
}

export interface ViewerManifestTask extends ViewerManifestTaskInput {
  paths: {
    attempt: string
    metadata: string
    messages: string
    trace: string
    grades: string
    screenshots: string
    graderArtifacts: string
  }
}

export interface ViewerManifest {
  runId: string
  suiteId: string
  variantId: string
  uploadedAt?: string
  summary: Record<string, unknown>
  tasks: ViewerManifestTask[]
}

export interface BuildViewerManifestInput {
  runId: string
  suiteId: string
  variantId: string
  uploadedAt?: string
  summary: Record<string, unknown>
  tasks: ViewerManifestTaskInput[]
}

/** Builds the compact JSON index consumed by the static R2 viewer. */
export function buildViewerManifest(
  input: BuildViewerManifestInput,
): ViewerManifest {
  return {
    runId: input.runId,
    suiteId: input.suiteId,
    variantId: input.variantId,
    uploadedAt: input.uploadedAt,
    summary: input.summary,
    tasks: input.tasks.map((task) => ({
      ...task,
      paths: {
        attempt: `tasks/${task.queryId}/attempt.json`,
        metadata: `tasks/${task.queryId}/metadata.json`,
        messages: `tasks/${task.queryId}/messages.jsonl`,
        trace: `tasks/${task.queryId}/trace.jsonl`,
        grades: `tasks/${task.queryId}/grades.json`,
        screenshots: `tasks/${task.queryId}/screenshots`,
        graderArtifacts: `tasks/${task.queryId}/grader-artifacts`,
      },
    })),
  }
}
