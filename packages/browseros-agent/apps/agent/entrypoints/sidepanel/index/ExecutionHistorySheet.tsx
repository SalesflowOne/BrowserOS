import { Eye, ShieldCheck } from 'lucide-react'
import { type FC, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { useConversationExecutionHistory } from '@/lib/execution-history/storage'
import { ExecutionTaskCard } from './ExecutionTaskCard'

export const ExecutionHistorySheet: FC<{
  conversationId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}> = ({ conversationId, open, onOpenChange }) => {
  const history = useConversationExecutionHistory(conversationId)

  const tasks = useMemo(() => {
    return [...(history?.tasks ?? [])].sort(
      (left, right) =>
        new Date(right.startedAt).getTime() -
        new Date(left.startedAt).getTime(),
    )
  }, [history?.tasks])

  const totalActions = tasks.reduce(
    (total, task) => total + task.actionCount,
    0,
  )
  const runningCount = tasks.filter((task) => task.status === 'running').length

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 sm:max-w-md">
        <SheetHeader className="gap-2 border-border/60 border-b pb-5">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-[var(--accent-orange)]" />
            <SheetTitle>Execution History</SheetTitle>
          </div>
          <SheetDescription>
            {tasks.length === 0
              ? 'No execution history has been recorded for this conversation yet.'
              : `${tasks.length} tasks • ${totalActions} actions${runningCount > 0 ? ` • ${runningCount} running` : ''}`}
          </SheetDescription>
        </SheetHeader>
        <ScrollArea className="flex-1">
          <div className="space-y-4 p-4">
            {tasks.length === 0 ? (
              <div className="rounded-2xl border border-border/70 border-dashed bg-muted/30 px-4 py-10 text-center">
                <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-background shadow-sm">
                  <Eye className="h-4 w-4 text-muted-foreground" />
                </div>
                <p className="mt-4 font-medium text-foreground text-sm">
                  No execution trace yet
                </p>
                <p className="mt-1 text-muted-foreground text-sm">
                  Run a task and the agent’s actions will appear here.
                </p>
              </div>
            ) : (
              tasks.map((task, index) => (
                <ExecutionTaskCard
                  key={task.id}
                  task={task}
                  defaultOpen={index === 0 || task.status === 'running'}
                />
              ))
            )}
          </div>
        </ScrollArea>
        <div className="border-border/60 border-t p-4">
          <Button
            variant="outline"
            className="w-full"
            onClick={() => onOpenChange(false)}
          >
            Close
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}
