import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@company/components/ui/dropdown-menu'
import { cn } from '@company/lib/utils'
import { useRecentWorkspaces } from '@company/modules/api/composer.hooks'
import { toastError } from '@company/modules/api/errorToast'
import { pickDirectory } from '@company/modules/system/pickDirectory'
import { ChevronDown, FolderOpen, MonitorDot } from 'lucide-react'
import type { FC } from 'react'
import { useState } from 'react'

interface Props {
  value: string | null
  fallbackLabel?: string
  onChange: (path: string | null) => void
  disabled?: boolean
}

function shortPath(path: string): string {
  const home = '/Users/'
  if (path.startsWith(home)) {
    const rest = path.slice(home.length)
    const slash = rest.indexOf('/')
    if (slash === -1) return '~'
    return `~${rest.slice(slash)}`
  }
  return path
}

export const ComposerWorkspacePicker: FC<Props> = ({
  value,
  fallbackLabel,
  onChange,
  disabled,
}) => {
  const { recent, addRecent } = useRecentWorkspaces()
  const [pending, setPending] = useState(false)

  const label = value ? shortPath(value) : (fallbackLabel ?? 'Default')

  const pickFolder = async () => {
    if (pending) return
    setPending(true)
    try {
      const next = await pickDirectory()
      if (next) {
        addRecent(next)
        onChange(next)
      }
    } catch (err) {
      toastError(err, 'Could not open folder picker')
    } finally {
      setPending(false)
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={disabled || pending}
        render={
          <button
            type="button"
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-card px-2 py-1 text-[12px] text-foreground transition-colors',
              'hover:border-border hover:bg-accent/40',
              'disabled:cursor-not-allowed disabled:opacity-50',
            )}
          />
        }
      >
        <MonitorDot className="size-3.5 text-muted-foreground" />
        <span className="max-w-[28ch] truncate font-medium">{label}</span>
        <ChevronDown className="size-3 text-muted-foreground/70" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[320px]">
        {recent.length > 0 && (
          <>
            {recent.map((path) => (
              <DropdownMenuItem
                key={path}
                onClick={() => onChange(path)}
                className="flex flex-col items-start gap-0"
              >
                <span className="truncate text-sm">{shortPath(path)}</span>
                <span className="truncate text-[10.5px] text-muted-foreground/70">
                  {path}
                </span>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem
          onClick={(e) => {
            e.preventDefault()
            void pickFolder()
          }}
          className="flex items-center gap-2"
        >
          <FolderOpen className="size-3.5 text-muted-foreground" />
          <span className="text-sm">Choose another folder…</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
