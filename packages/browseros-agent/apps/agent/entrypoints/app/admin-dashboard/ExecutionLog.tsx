import {
  CheckCircle2,
  ScrollText,
  ShieldCheck,
  ShieldX,
  XCircle,
} from 'lucide-react'
import { type FC, useEffect, useRef, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import {
  type ToolExecutionLogEntry,
  toolExecutionLogStorage,
} from '@/lib/tool-approvals/approval-sync-storage'

const formatToolName = (name: string) =>
  name
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^./, (s) => s.toUpperCase())

const formatTime = (timestamp: number) =>
  new Date(timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })

const STATUS_CONFIG = {
  'auto-allowed': {
    icon: CheckCircle2,
    label: 'Auto',
    className: 'text-green-600',
    badgeVariant: 'outline' as const,
  },
  approved: {
    icon: ShieldCheck,
    label: 'Approved',
    className: 'text-green-600',
    badgeVariant: 'outline' as const,
  },
  denied: {
    icon: ShieldX,
    label: 'Denied',
    className: 'text-red-500',
    badgeVariant: 'destructive' as const,
  },
  error: {
    icon: XCircle,
    label: 'Error',
    className: 'text-red-500',
    badgeVariant: 'destructive' as const,
  },
}

export const ExecutionLog: FC = () => {
  const [log, setLog] = useState<ToolExecutionLogEntry[]>([])
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    toolExecutionLogStorage.getValue().then(setLog)
    const unwatch = toolExecutionLogStorage.watch(setLog)
    return () => unwatch()
  }, [])

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll to bottom when new entries arrive
  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: 'smooth',
    })
  }, [log.length])

  if (log.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed bg-card/50 py-12 text-center">
        <ScrollText className="mb-3 size-8 text-muted-foreground/40" />
        <p className="font-medium text-muted-foreground text-sm">
          No executions yet
        </p>
        <p className="mt-1 max-w-xs text-muted-foreground/70 text-xs">
          Tool execution history will appear here as the agent runs.
        </p>
      </div>
    )
  }

  return (
    <div
      ref={scrollRef}
      className="max-h-80 space-y-1 overflow-y-auto rounded-lg border bg-card p-2"
    >
      {log.map((entry) => {
        const config = STATUS_CONFIG[entry.status]
        const Icon = config.icon
        return (
          <div
            key={`${entry.toolCallId}-${entry.timestamp}`}
            className="flex items-center gap-3 rounded-md px-3 py-1.5 text-sm hover:bg-muted/50"
          >
            <Icon className={`size-3.5 shrink-0 ${config.className}`} />
            <span className="min-w-0 flex-1 truncate">
              {formatToolName(entry.toolName)}
            </span>
            <Badge
              variant={config.badgeVariant}
              className="shrink-0 text-[10px]"
            >
              {config.label}
            </Badge>
            <span className="shrink-0 font-mono text-muted-foreground text-xs">
              {formatTime(entry.timestamp)}
            </span>
          </div>
        )
      })}
    </div>
  )
}
