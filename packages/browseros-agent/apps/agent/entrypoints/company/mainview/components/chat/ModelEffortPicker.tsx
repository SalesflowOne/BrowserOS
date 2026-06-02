import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@company/components/ui/dropdown-menu'
import { AGENT_CAPABILITIES, type AgentKind } from '@company/lib/capabilities'
import { cn } from '@company/lib/utils'
import { Check, ChevronDown, Sparkles } from 'lucide-react'
import type { FC } from 'react'

interface Props {
  agentKind: AgentKind
  modelId: string
  reasoningEffort: string | null
  onChangeModel: (id: string) => void
  onChangeEffort: (effort: string) => void
  disabled?: boolean
}

const EFFORT_LABELS: Record<string, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra High',
  max: 'Max',
}

function effortLabel(value: string): string {
  return EFFORT_LABELS[value] ?? value
}

export const ModelEffortPicker: FC<Props> = ({
  agentKind,
  modelId,
  reasoningEffort,
  onChangeModel,
  onChangeEffort,
  disabled,
}) => {
  const caps = AGENT_CAPABILITIES[agentKind]
  const model = caps.models.find((m) => m.id === modelId) ?? caps.models[0]
  const hasEffort = caps.effortValues.length > 0
  const triggerLabel =
    hasEffort && reasoningEffort
      ? `${model?.label ?? modelId} · ${effortLabel(reasoningEffort)}`
      : (model?.label ?? modelId)

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
        <Sparkles className="size-3.5 text-muted-foreground" />
        <span className="truncate font-medium">{triggerLabel}</span>
        <ChevronDown className="size-3 text-muted-foreground/70" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[260px]">
        {hasEffort && (
          <>
            <DropdownMenuGroup>
              <DropdownMenuLabel className="text-[10.5px] text-muted-foreground/70 uppercase tracking-[0.14em]">
                Intelligence
              </DropdownMenuLabel>
              {caps.effortValues.map((tier) => (
                <DropdownMenuItem
                  key={tier}
                  onClick={() => onChangeEffort(tier)}
                  className="flex items-center justify-between gap-2"
                >
                  <span className="text-sm">{effortLabel(tier)}</span>
                  {tier === reasoningEffort && (
                    <Check className="size-3.5 text-foreground" />
                  )}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuGroup>
          <DropdownMenuLabel className="text-[10.5px] text-muted-foreground/70 uppercase tracking-[0.14em]">
            Model
          </DropdownMenuLabel>
          {caps.models.map((m) => (
            <DropdownMenuItem
              key={m.id}
              onClick={() => onChangeModel(m.id)}
              className="flex flex-col items-start gap-0.5"
            >
              <span className="flex w-full items-center justify-between gap-2">
                <span className="font-medium text-sm">{m.label}</span>
                {m.id === modelId && (
                  <Check className="size-3.5 text-foreground" />
                )}
              </span>
              {m.description && (
                <span className="text-[11px] text-muted-foreground">
                  {m.description}
                </span>
              )}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
