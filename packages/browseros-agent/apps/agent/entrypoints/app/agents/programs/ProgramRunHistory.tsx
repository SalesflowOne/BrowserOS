import type { BrowserOSProgramRun } from '@browseros/shared/types/role-programs'
import { AlertCircle, CheckCircle2, Clock3, Loader2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'

interface ProgramRunHistoryProps {
  runs: BrowserOSProgramRun[]
  loading: boolean
  programNames: Record<string, string>
  onViewRun: (run: BrowserOSProgramRun) => void
}

function formatDateTime(value?: string): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}

function RunStatusBadge({ status }: { status: BrowserOSProgramRun['status'] }) {
  switch (status) {
    case 'running':
      return <Badge variant="secondary">Running</Badge>
    case 'completed':
      return <Badge variant="default">Completed</Badge>
    case 'failed':
      return <Badge variant="destructive">Failed</Badge>
    case 'cancelled':
      return <Badge variant="outline">Cancelled</Badge>
    case 'pending':
    default:
      return <Badge variant="outline">Pending</Badge>
  }
}

export function ProgramRunHistory({
  runs,
  loading,
  programNames,
  onViewRun,
}: ProgramRunHistoryProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Recent Runs</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : runs.length === 0 ? (
          <div className="rounded-lg border border-dashed p-4 text-muted-foreground text-sm">
            No runs yet. Run a program manually to validate it.
          </div>
        ) : (
          <ScrollArea className="h-[340px] pr-3">
            <div className="space-y-3">
              {runs.map((run) => (
                <div key={run.id} className="rounded-lg border p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <div className="font-medium text-sm">
                        {programNames[run.programId] ?? 'Unknown Program'}
                      </div>
                      <div className="text-muted-foreground text-xs">
                        Trigger: {run.trigger}
                      </div>
                    </div>
                    <RunStatusBadge status={run.status} />
                  </div>

                  <div className="mt-3 space-y-1 text-muted-foreground text-xs">
                    <div className="flex items-center gap-2">
                      <Clock3 className="size-3.5" />
                      Started: {formatDateTime(run.startedAt)}
                    </div>
                    <div className="flex items-center gap-2">
                      {run.status === 'failed' ? (
                        <AlertCircle className="size-3.5 text-destructive" />
                      ) : (
                        <CheckCircle2 className="size-3.5 text-muted-foreground" />
                      )}
                      Completed: {formatDateTime(run.completedAt)}
                    </div>
                  </div>

                  {run.summary && <p className="mt-3 text-sm">{run.summary}</p>}

                  {!run.summary && run.finalResult && (
                    <p className="mt-3 line-clamp-4 text-sm">
                      {run.finalResult}
                    </p>
                  )}

                  {run.error && (
                    <p className="mt-3 text-destructive text-sm">{run.error}</p>
                  )}

                  {(run.finalResult || run.error) && (
                    <div className="mt-3 flex justify-end">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => onViewRun(run)}
                      >
                        View Results
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  )
}
