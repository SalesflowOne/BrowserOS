export interface ShowcaseConfig {
  tasks: string
  output: string
  upload: boolean
  model: string
  provider: string
  apiKeyEnv: string
  cdpPort?: number
  timeout: number
}

export interface ShowcaseStep {
  stepIndex: number
  toolName: string
  toolInput: Record<string, unknown>
  toolOutput: unknown
  elementCoordinates?: { x: number; y: number }
  beforeScreenshot: string
  afterScreenshot: string
  annotatedScreenshot?: string
  accessibilitySnapshot: string
  assistantText?: string
  timestamp: string
}

export interface ShowcaseTaskManifest {
  executionId: string
  taskId: string
  query: string
  startUrl: string
  dataset: string
  steps: ShowcaseStep[]
  finalAnswer: string | null
  agentConfig: { model: string; provider: string }
  totalDurationMs: number
  createdAt: string
  uploadedAt?: string
}

export interface ShowcaseRunIndex {
  runId: string
  createdAt: string
  uploadedAt?: string
  agentConfig: { model: string; provider: string }
  tasks: Array<{
    executionId: string
    taskId: string
    query: string
    stepCount: number
    status: 'completed' | 'timeout' | 'failed'
    manifestPath: string
  }>
}
