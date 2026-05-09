import type {
  ScheduledJob,
  ScheduledJobRun,
} from '@/lib/schedules/scheduleTypes'

export interface JobRunWithDetails extends ScheduledJobRun {
  job: ScheduledJob | undefined
}

export interface ScheduledTaskRunGroup {
  id: string
  name: string
  job: ScheduledJob | undefined
  runs: JobRunWithDetails[]
  latestRun: JobRunWithDetails
  resultCount: number
}

interface GroupScheduledTaskRunsInput {
  jobs: ScheduledJob[]
  runs: ScheduledJobRun[]
}

const getStartedAtMs = (run: ScheduledJobRun) => {
  const time = new Date(run.startedAt).getTime()
  return Number.isNaN(time) ? 0 : time
}

const compareRunsByNewest = (a: ScheduledJobRun, b: ScheduledJobRun) =>
  getStartedAtMs(b) - getStartedAtMs(a)

const compareRunsForDisplay = (a: ScheduledJobRun, b: ScheduledJobRun) => {
  if (a.status === 'running' && b.status !== 'running') return -1
  if (a.status !== 'running' && b.status === 'running') return 1
  return compareRunsByNewest(a, b)
}

export function groupScheduledTaskRuns({
  jobs,
  runs,
}: GroupScheduledTaskRunsInput): ScheduledTaskRunGroup[] {
  const jobsById = new Map(jobs.map((job) => [job.id, job]))
  const groupsByJobId = new Map<string, JobRunWithDetails[]>()

  for (const run of runs) {
    const job = jobsById.get(run.jobId)
    const enrichedRun: JobRunWithDetails = { ...run, job }
    const existing = groupsByJobId.get(run.jobId)

    if (existing) {
      existing.push(enrichedRun)
    } else {
      groupsByJobId.set(run.jobId, [enrichedRun])
    }
  }

  return [...groupsByJobId.entries()]
    .map(([jobId, groupRuns]) => {
      const sortedRuns = [...groupRuns].sort(compareRunsForDisplay)
      const latestRun = [...groupRuns].sort(compareRunsByNewest)[0]
      const job = jobsById.get(jobId)

      return {
        id: jobId,
        name: job?.name ?? 'Unknown scheduled task',
        job,
        runs: sortedRuns,
        latestRun,
        resultCount: sortedRuns.length,
      }
    })
    .filter((group): group is ScheduledTaskRunGroup => Boolean(group.latestRun))
    .sort((a, b) => compareRunsByNewest(a.latestRun, b.latestRun))
}
