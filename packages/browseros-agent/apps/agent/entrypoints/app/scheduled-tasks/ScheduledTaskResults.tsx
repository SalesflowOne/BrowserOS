import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import {
  Calendar,
  CheckCircle2,
  ChevronDown,
  Clock,
  Loader2,
  RotateCcw,
  Square,
  XCircle,
} from 'lucide-react'
import type { FC } from 'react'
import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  useScheduledJobRuns,
  useScheduledJobs,
} from '@/lib/schedules/scheduleStorage'
import type { ScheduledJobRun } from '@/lib/schedules/scheduleTypes'
import {
  groupScheduledTaskRuns,
  type JobRunWithDetails,
} from './scheduledTaskResultsUtils'

dayjs.extend(relativeTime)

interface ScheduledTaskResultsProps {
  onViewRun: (run: ScheduledJobRun) => void
  onCancelRun: (runId: string) => void
  onRetryRun: (jobId: string) => void
}

const getStatusIcon = (status: JobRunWithDetails['status']) => {
  switch (status) {
    case 'completed':
      return <CheckCircle2 className="h-4 w-4 text-green-500" />
    case 'running':
      return <Loader2 className="h-4 w-4 animate-spin text-accent-orange" />
    case 'failed':
      return <XCircle className="h-4 w-4 text-destructive" />
  }
}

const formatTimestamp = (dateString: string) => dayjs(dateString).fromNow()

const formatRunTimestamp = (dateString: string) => {
  const date = dayjs(dateString)

  if (date.isSame(dayjs(), 'day')) {
    return `Today, ${date.format('h:mm A')}`
  }
  if (date.isSame(dayjs().subtract(1, 'day'), 'day')) {
    return `Yesterday, ${date.format('h:mm A')}`
  }

  return date.format('MMM D, h:mm A')
}

const getRunPreview = (run: JobRunWithDetails) =>
  run.finalResult ?? run.result ?? run.error

export const ScheduledTaskResults: FC<ScheduledTaskResultsProps> = ({
  onViewRun,
  onCancelRun,
  onRetryRun,
}) => {
  const { jobRuns } = useScheduledJobRuns()
  const { jobs } = useScheduledJobs()

  const taskGroups = useMemo(
    () => groupScheduledTaskRuns({ runs: jobRuns, jobs }),
    [jobRuns, jobs],
  )
  const [expandedGroupId, setExpandedGroupId] = useState<
    string | null | undefined
  >(undefined)

  const visibleExpandedGroupId =
    expandedGroupId === undefined
      ? (taskGroups[0]?.id ?? null)
      : expandedGroupId !== null &&
          !taskGroups.some((group) => group.id === expandedGroupId)
        ? (taskGroups[0]?.id ?? null)
        : expandedGroupId

  if (!taskGroups.length) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground">
        <Calendar className="h-10 w-10 opacity-50" />
        <p className="text-sm">No task runs yet</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {taskGroups.map((group) => (
        <Collapsible
          key={group.id}
          open={visibleExpandedGroupId === group.id}
          onOpenChange={(open) => setExpandedGroupId(open ? group.id : null)}
          className="rounded-xl border border-border bg-card shadow-sm transition-all hover:border-border"
        >
          <CollapsibleTrigger className="flex w-full items-center gap-3 p-4 text-left transition-colors hover:bg-accent/40">
            <ChevronDown
              className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 ${
                visibleExpandedGroupId === group.id ? '' : '-rotate-90'
              }`}
            />
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted">
              {getStatusIcon(group.latestRun.status)}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-2">
                <span className="truncate font-medium text-foreground">
                  {group.name}
                </span>
                <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-muted-foreground text-xs">
                  {group.resultCount}{' '}
                  {group.resultCount === 1 ? 'result' : 'results'}
                </span>
              </div>
              <div className="mt-1 flex items-center gap-1 text-muted-foreground text-xs">
                <Clock className="h-3 w-3" />
                <span>Latest {formatTimestamp(group.latestRun.startedAt)}</span>
              </div>
            </div>
          </CollapsibleTrigger>
          <CollapsibleContent className="border-border border-t px-4 pt-3 pb-4">
            <div className="space-y-2">
              {group.runs.map((run) => {
                const preview = getRunPreview(run)

                return (
                  <div
                    key={run.id}
                    className="flex items-start gap-3 rounded-lg border border-border bg-background p-3"
                  >
                    <div className="pt-0.5">{getStatusIcon(run.status)}</div>
                    <button
                      type="button"
                      onClick={() => onViewRun(run)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-foreground text-sm">
                          {formatRunTimestamp(run.startedAt)}
                        </span>
                        <span className="text-muted-foreground text-xs">
                          {run.status}
                        </span>
                      </div>
                      {preview && (
                        <p className="mt-1 line-clamp-2 text-muted-foreground text-xs">
                          {preview}
                        </p>
                      )}
                    </button>
                    <div className="flex shrink-0 items-center gap-1">
                      {run.status === 'running' && (
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => onCancelRun(run.id)}
                          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                          aria-label="Cancel run"
                        >
                          <Square className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      {run.status === 'failed' && (
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => onRetryRun(run.jobId)}
                          className="text-muted-foreground hover:text-foreground"
                          aria-label="Retry run"
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onViewRun(run)}
                        className="text-muted-foreground hover:text-foreground"
                      >
                        View
                      </Button>
                    </div>
                  </div>
                )
              })}
            </div>
          </CollapsibleContent>
        </Collapsible>
      ))}
    </div>
  )
}
