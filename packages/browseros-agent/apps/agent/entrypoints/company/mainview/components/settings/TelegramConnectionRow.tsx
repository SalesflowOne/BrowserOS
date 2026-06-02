import { Button } from '@company/components/ui/button'
import type { TelegramConnection } from '@company/modules/api/telegram.hooks'
import { RotateCw, Trash2 } from 'lucide-react'

interface Props {
  connection: TelegramConnection
  employeeName: string | null
  onRestart: () => void
  onRemove: () => void
  disabled: boolean
}

export function TelegramConnectionRow({
  connection,
  employeeName,
  onRestart,
  onRemove,
  disabled,
}: Props) {
  const statusLabel = formatRuntime(connection.runtime, connection.status)
  const statusTone = toneFor(connection.runtime, connection.status)

  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium text-sm">
            {connection.name}
          </span>
          <span
            className={`rounded-md border px-1.5 py-0.5 text-xs ${statusTone}`}
          >
            {statusLabel}
          </span>
        </div>
        <p className="mt-1 truncate text-muted-foreground text-xs">
          {employeeName ? (
            <>
              <span className="font-medium">{employeeName}</span>
              {connection.botUsername ? (
                <span>
                  {' · '}
                  <span className="font-mono">@{connection.botUsername}</span>
                </span>
              ) : null}
            </>
          ) : (
            'Employee no longer exists'
          )}
        </p>
        {connection.lastError ? (
          <p className="mt-1 truncate text-destructive text-xs">
            {connection.lastError}
          </p>
        ) : null}
      </div>
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onRestart}
          disabled={disabled}
          aria-label={`Restart ${connection.name}`}
        >
          <RotateCw className="size-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onRemove}
          disabled={disabled}
          aria-label={`Remove ${connection.name}`}
        >
          <Trash2 className="size-4" />
        </Button>
      </div>
    </li>
  )
}

function formatRuntime(
  runtime: TelegramConnection['runtime'],
  status: TelegramConnection['status'],
): string {
  if (status === 'error') return 'error'
  if (runtime === 'running') return 'running'
  if (runtime === 'starting') return 'starting'
  return 'stopped'
}

function toneFor(
  runtime: TelegramConnection['runtime'],
  status: TelegramConnection['status'],
): string {
  if (status === 'error') {
    return 'border-destructive/40 bg-destructive/10 text-destructive'
  }
  if (runtime === 'running') {
    return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
  }
  if (runtime === 'starting') {
    return 'border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400'
  }
  return 'border-border/70 text-muted-foreground'
}
