import { Badge } from '@company/components/ui/badge'
import { formatClockTime } from '@company/lib/dateTime'
import type {
  ChatTurn,
  TurnStatus,
} from '@company/modules/api/threadEventStream'
import type { FC } from 'react'

// Per-turn header shown above the first assistant part. Surfaces the
// agent + model that actually ran (captured on turn.start so the badge
// stays accurate when the user flips the composer tuple for the next
// turn) plus inline cancelled/error badges and the start timestamp.
export const AssistantMeta: FC<{ turn: ChatTurn; fallbackName: string }> = ({
  turn,
  fallbackName,
}) => {
  const agentLabel = (turn.agentKind ?? fallbackName).toUpperCase()
  return (
    <div className="flex items-center gap-2 pl-10 text-xs">
      <span className="font-mono text-muted-foreground uppercase tracking-wider">
        {agentLabel}
      </span>
      {turn.modelId ? (
        <span className="font-mono text-[10px] text-muted-foreground/70 tabular-nums">
          {turn.modelId}
        </span>
      ) : null}
      <StatusBadge status={turn.status} />
      <span className="ml-auto text-[10px] text-muted-foreground/60 tabular-nums">
        {formatClockTime(turn.startedAt)}
      </span>
    </div>
  )
}

const StatusBadge: FC<{ status: TurnStatus }> = ({ status }) => {
  if (status === 'cancelled') {
    return (
      <Badge variant="outline" className="h-4 px-1.5 text-[10px]">
        cancelled
      </Badge>
    )
  }
  if (status === 'error') {
    return (
      <Badge variant="destructive" className="h-4 px-1.5 text-[10px]">
        error
      </Badge>
    )
  }
  return null
}

// Structured red error block. `message` is always present; `code` and
// `details` are added when extractErrorDetails could derive them
// upstream. Layout mirrors the test-results error UI: bold red summary
// on top, optional monospace `code: details` pre block underneath.
export const ErrorBlock: FC<{
  message: string
  code?: string
  details?: string
}> = ({ message, code, details }) => (
  <div className="space-y-2 rounded-md border border-destructive/30 bg-destructive/5 p-3">
    <p className="font-medium text-destructive text-sm">{message}</p>
    {code || details ? (
      <pre className="max-h-56 overflow-auto whitespace-pre-wrap font-mono text-[11px] text-destructive/80">
        {code ? <span className="opacity-70">{code}: </span> : null}
        {details ?? ''}
      </pre>
    ) : null}
  </div>
)
