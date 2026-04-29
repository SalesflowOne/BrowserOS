import { describe, expect, it } from 'bun:test'
import { buildViewerManifest } from '../../src/viewer/viewer-manifest'

describe('buildViewerManifest', () => {
  it('indexes task artifacts for the R2 viewer', () => {
    const manifest = buildViewerManifest({
      runId: 'run-1',
      suiteId: 'agisdk-daily-10',
      variantId: 'kimi',
      uploadedAt: '2026-04-29T06:00:00.000Z',
      summary: { total: 1, passRate: 0 },
      tasks: [
        {
          queryId: 'agisdk-dashdish-4',
          query: 'Schedule a delivery order',
          startUrl: 'https://evals-dashdish.vercel.app',
          status: 'completed',
          durationMs: 353_000,
          screenshotCount: 42,
          graderResults: {
            agisdk_state_diff: {
              score: 0,
              pass: false,
              reasoning: 'Missing checkout item',
            },
          },
        },
      ],
    })

    expect(manifest.tasks[0].paths.messages).toBe(
      'tasks/agisdk-dashdish-4/messages.jsonl',
    )
    expect(manifest.tasks[0].paths.screenshots).toBe(
      'tasks/agisdk-dashdish-4/screenshots',
    )
    expect(manifest.tasks[0].paths.graderArtifacts).toBe(
      'tasks/agisdk-dashdish-4/grader-artifacts',
    )
  })
})
