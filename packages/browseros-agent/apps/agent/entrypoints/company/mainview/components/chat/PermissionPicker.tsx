import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@company/components/ui/dropdown-menu'
import { cn } from '@company/lib/utils'
import {
  Check,
  ChevronDown,
  Eye,
  Hand,
  OctagonAlert,
  ShieldCheck,
} from 'lucide-react'
import type { FC } from 'react'
import {
  PERMISSION_MODES,
  type PermissionMode,
} from '../../../shared/permission'

interface Option {
  value: PermissionMode
  label: string
  description: string
  icon: typeof ShieldCheck
  danger: boolean
}

// Render order matches the dropdown layout. Safe options first;
// `allow-all` last, behind a separator (rendered conditionally),
// with amber styling on both icon and label so the chip reads as a
// "you sure?" choice when active. Mirrors Codex's "Full access".
const OPTIONS: readonly Option[] = [
  {
    value: 'auto-approve-reads',
    label: 'Auto-approve reads',
    description: 'Reads pass; writes & shell prompt you',
    icon: ShieldCheck,
    danger: false,
  },
  {
    value: 'manual',
    label: 'Approve each request',
    description: 'Every gate prompts you',
    icon: Hand,
    danger: false,
  },
  {
    value: 'read-only',
    label: 'Read-only',
    description: 'Reads pass; writes & shell auto-denied',
    icon: Eye,
    danger: false,
  },
  {
    value: 'allow-all',
    label: 'Allow everything',
    description: 'Agent runs unattended — use with care',
    icon: OctagonAlert,
    danger: true,
  },
] as const

const BY_VALUE = new Map(OPTIONS.map((o) => [o.value, o]))

interface PermissionPickerProps {
  value: PermissionMode
  onChange: (mode: PermissionMode) => void
  disabled?: boolean
  disabledReason?: string
}

export const PermissionPicker: FC<PermissionPickerProps> = ({
  value,
  onChange,
  disabled,
  disabledReason,
}) => {
  // Fall back to the first option if `value` is somehow not one of
  // the known modes (forward-compat: a row could have a stored mode
  // from a future build that introduces a new enum value).
  const active = BY_VALUE.get(value) ?? OPTIONS[0]
  if (!active) return null
  const ActiveIcon = active.icon
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={disabled}
        render={
          <button
            type="button"
            title={disabledReason ?? `Permission mode: ${active.label}`}
            aria-disabled={disabled}
            className={cn(
              'app-region-no-drag inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-card px-2 py-1 text-[12px] text-foreground transition-colors',
              'hover:border-border hover:bg-accent/40',
              'disabled:cursor-not-allowed disabled:opacity-50',
              active.danger &&
                'border-amber-500/30 bg-amber-500/5 text-amber-700 hover:bg-amber-500/10 dark:text-amber-400',
            )}
          />
        }
      >
        <ActiveIcon
          className={cn(
            'size-3.5',
            active.danger
              ? 'text-amber-600 dark:text-amber-500'
              : 'text-muted-foreground',
          )}
        />
        <span className="truncate font-medium">{active.label}</span>
        <ChevronDown className="size-3 text-muted-foreground/70" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[260px]">
        {PERMISSION_MODES.map((mode) => {
          const opt = BY_VALUE.get(mode)
          if (!opt) return null
          const Icon = opt.icon
          // The danger option lands after a separator so it doesn't
          // sit flush against the safe choices in the muscle-memory
          // arrow-key list.
          const needsSeparator = opt.danger
          return (
            <div key={opt.value}>
              {needsSeparator && <DropdownMenuSeparator />}
              <DropdownMenuItem
                onClick={() => onChange(opt.value)}
                className={cn(
                  'flex flex-col items-start gap-0.5',
                  opt.danger &&
                    'text-amber-700 focus:text-amber-700 dark:text-amber-400 dark:focus:text-amber-400',
                )}
              >
                <span className="flex w-full items-center justify-between gap-2">
                  <span className="flex items-center gap-2">
                    <Icon
                      className={cn(
                        'size-3.5',
                        opt.danger && 'text-amber-600 dark:text-amber-500',
                      )}
                    />
                    <span className="font-medium text-sm">{opt.label}</span>
                  </span>
                  {value === opt.value && (
                    <Check className="size-3.5 text-foreground" />
                  )}
                </span>
                <span className="pl-[22px] text-[11px] text-muted-foreground">
                  {opt.description}
                </span>
              </DropdownMenuItem>
            </div>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
