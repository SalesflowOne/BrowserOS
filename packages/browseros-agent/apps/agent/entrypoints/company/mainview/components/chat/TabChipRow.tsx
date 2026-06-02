import { cn } from '@company/lib/utils'
import { X } from 'lucide-react'
import type { BrowserTabAttachment } from '../../../shared/attachments'

interface Props {
  attachments: BrowserTabAttachment[]
  onRemove: (pageId: number) => void
  disabled?: boolean
}

export function TabChipRow({ attachments, onRemove, disabled }: Props) {
  if (attachments.length === 0) return null
  return (
    <div className="flex flex-wrap gap-1.5 px-1 pb-1">
      {attachments.map((a) => (
        <span
          key={a.pageId}
          className={cn(
            'inline-flex max-w-[260px] items-center gap-1 rounded-full border border-border/60 bg-muted/60 py-0.5 pr-1 pl-2 text-foreground/90 text-xs',
          )}
        >
          <span className="truncate" title={`${a.title}\n${a.url}`}>
            {a.title || a.url}
          </span>
          <button
            type="button"
            aria-label="Remove tab"
            disabled={disabled}
            onClick={() => onRemove(a.pageId)}
            className={cn(
              'inline-flex size-4 shrink-0 items-center justify-center rounded-full text-muted-foreground/80 transition-colors',
              'hover:bg-foreground/10 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40',
            )}
          >
            <X className="size-3" />
          </button>
        </span>
      ))}
    </div>
  )
}
