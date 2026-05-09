import { describe, expect, it } from 'bun:test'
import type {
  ScheduledJob,
  ScheduledJobRun,
} from '@/lib/schedules/scheduleTypes'
import { groupScheduledTaskRuns } from './scheduledTaskResultsUtils'

function makeJob(input: Pick<ScheduledJob, 'id' | 'name'>): ScheduledJob {
  return {
    ...input,
    query: `Query for ${input.name}`,
    scheduleType: 'daily',
    scheduleTime: '09:00',
    enabled: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

function makeRun(input: {
  id: string
  jobId: string
  startedAt: string
  status?: ScheduledJobRun['status']
}): ScheduledJobRun {
  return {
    id: input.id,
    jobId: input.jobId,
    startedAt: input.startedAt,
    status: input.status ?? 'completed',
    result: `Result for ${input.id}`,
  }
}

describe('groupScheduledTaskRuns', () => {
  it('groups runs by scheduled task and sorts groups by latest run', () => {
    const groups = groupScheduledTaskRuns({
      jobs: [makeJob({ id: 'news', name: 'Morning News' })],
      runs: [
        makeRun({
          id: 'news-old',
          jobId: 'news',
          startedAt: '2026-01-02T09:00:00.000Z',
        }),
        makeRun({
          id: 'prices-new',
          jobId: 'prices',
          startedAt: '2026-01-03T14:00:00.000Z',
        }),
        makeRun({
          id: 'news-new',
          jobId: 'news',
          startedAt: '2026-01-04T09:00:00.000Z',
        }),
      ],
    })

    expect(groups.map((group) => group.id)).toEqual(['news', 'prices'])
    expect(groups[0]).toMatchObject({
      id: 'news',
      name: 'Morning News',
      resultCount: 2,
      latestRun: { id: 'news-new' },
    })
    expect(groups[0]?.runs.map((run) => run.id)).toEqual([
      'news-new',
      'news-old',
    ])
  })

  it('keeps missing jobs visible under an unknown task label', () => {
    const groups = groupScheduledTaskRuns({
      jobs: [],
      runs: [
        makeRun({
          id: 'orphan-run',
          jobId: 'deleted-job',
          startedAt: '2026-01-02T09:00:00.000Z',
        }),
      ],
    })

    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({
      id: 'deleted-job',
      name: 'Unknown scheduled task',
      resultCount: 1,
      latestRun: { id: 'orphan-run' },
    })
  })

  it('keeps running runs first without changing the latest-run header data', () => {
    const groups = groupScheduledTaskRuns({
      jobs: [makeJob({ id: 'news', name: 'Morning News' })],
      runs: [
        makeRun({
          id: 'completed-new',
          jobId: 'news',
          startedAt: '2026-01-04T09:00:00.000Z',
          status: 'completed',
        }),
        makeRun({
          id: 'running-old',
          jobId: 'news',
          startedAt: '2026-01-03T09:00:00.000Z',
          status: 'running',
        }),
      ],
    })

    expect(groups[0]?.latestRun.id).toBe('completed-new')
    expect(groups[0]?.runs.map((run) => run.id)).toEqual([
      'running-old',
      'completed-new',
    ])
  })
})
