import { cn } from '@company/lib/utils'
import { toastError } from '@company/modules/api/errorToast'
import { pickDirectory } from '@company/modules/system/pickDirectory'
import { Folder, X } from 'lucide-react'
import { type FC, useState } from 'react'

interface Props {
  // null means "use the server-side sandbox default" — the renderer never
  // tries to guess the auto-generated id, it just signals omission.
  value: string | null
  onChange: (path: string | null) => void
}

export const WorkspacePicker: FC<Props> = ({ value, onChange }) => {
  const [pending, setPending] = useState(false)

  const pick = async () => {
    if (pending) return
    setPending(true)
    try {
      const picked = await pickDirectory()
      if (picked) onChange(picked)
    } catch (err) {
      toastError(err, 'Could not open folder picker')
    } finally {
      setPending(false)
    }
  }

  if (value === null) {
    return (
      <button
        type="button"
        onClick={pick}
        disabled={pending}
        className={cn(
          'flex w-full items-center gap-2 rounded-md border border-border/60 bg-card px-3 py-1.5 text-left text-[12.5px] transition-colors disabled:opacity-60',
          'hover:border-[color:var(--accent-orange)]/40',
        )}
      >
        <Folder className="size-3.5 text-muted-foreground" />
        <span className="flex-1 truncate text-muted-foreground">
          Sandbox (auto-generated)
        </span>
        <span className="font-medium text-[11.5px] text-[color:var(--accent-orange)]">
          {pending ? 'Picking…' : 'Pick…'}
        </span>
      </button>
    )
  }

  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        onClick={pick}
        disabled={pending}
        title={value}
        className={cn(
          'flex flex-1 items-center gap-2 rounded-md border border-border/60 bg-card px-3 py-1.5 text-left transition-colors disabled:opacity-60',
          'hover:border-[color:var(--accent-orange)]/40',
        )}
      >
        <Folder className="size-3.5 shrink-0 text-[color:var(--accent-orange)]" />
        <span className="flex-1 truncate font-mono text-[11.5px] text-foreground">
          {value}
        </span>
        <span className="font-medium text-[11px] text-muted-foreground">
          {pending ? 'Picking…' : 'Change…'}
        </span>
      </button>
      <button
        type="button"
        onClick={() => onChange(null)}
        aria-label="Use sandbox default"
        className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-accent hover:text-foreground"
      >
        <X className="size-3.5" />
      </button>
    </div>
  )
}
