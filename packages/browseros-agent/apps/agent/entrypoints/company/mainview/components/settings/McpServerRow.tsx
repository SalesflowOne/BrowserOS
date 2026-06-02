import { Button } from '@company/components/ui/button'
import type { McpServer } from '@company/modules/api/system.hooks'
import { Pencil, Trash2 } from 'lucide-react'

interface Props {
  server: McpServer
  onEdit: () => void
  onRemove: () => void
  disabled: boolean
}

export function McpServerRow({ server, onEdit, onRemove, disabled }: Props) {
  const transport = server.type === 'stdio' ? 'stdio' : server.type
  const detail =
    server.type === 'stdio'
      ? formatCommand(server.command, server.args)
      : server.url
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium text-sm">{server.name}</span>
          <span className="rounded-md border border-border/70 px-1.5 py-0.5 text-muted-foreground text-xs">
            {transport}
          </span>
        </div>
        <p className="mt-1 truncate text-muted-foreground text-xs">{detail}</p>
      </div>
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onEdit}
          disabled={disabled}
          aria-label={`Edit ${server.name}`}
        >
          <Pencil className="size-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onRemove}
          disabled={disabled}
          aria-label={`Remove ${server.name}`}
        >
          <Trash2 className="size-4" />
        </Button>
      </div>
    </li>
  )
}

function formatCommand(command: string, args: string[]): string {
  return args.length === 0 ? command : `${command} ${args.join(' ')}`
}
