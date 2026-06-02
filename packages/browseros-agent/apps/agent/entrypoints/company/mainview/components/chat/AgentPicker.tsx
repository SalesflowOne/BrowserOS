import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@company/components/ui/dropdown-menu'
import {
  AGENT_CAPABILITIES,
  AGENT_KINDS,
  type AgentKind,
} from '@company/lib/capabilities'
import { cn } from '@company/lib/utils'
import { Bot, Check, ChevronDown } from 'lucide-react'
import type { FC } from 'react'

interface Props {
  value: AgentKind
  onChange: (next: AgentKind) => void
  disabled?: boolean
}

export const AgentPicker: FC<Props> = ({ value, onChange, disabled }) => {
  const current = AGENT_CAPABILITIES[value]
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={disabled}
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
        <Bot className="size-3.5 text-muted-foreground" />
        <span className="font-medium">{current.label}</span>
        <ChevronDown className="size-3 text-muted-foreground/70" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[200px]">
        {AGENT_KINDS.map((kind) => {
          const caps = AGENT_CAPABILITIES[kind]
          const selected = kind === value
          return (
            <DropdownMenuItem
              key={kind}
              onClick={() => onChange(kind)}
              className="flex items-center justify-between gap-2"
            >
              <span className="flex items-center gap-2">
                <Bot className="size-3.5 text-muted-foreground" />
                <span className="text-sm">{caps.label}</span>
              </span>
              {selected && <Check className="size-3.5 text-foreground" />}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
