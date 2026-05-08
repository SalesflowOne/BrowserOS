import type { FC } from 'react'
import { adapterLabel } from '../AdapterIcon'
import type { HarnessAgentAdapter } from '../agent-harness-types'
import type { AgentAdapterHealth } from './agent-row.types'

interface AgentSummaryChipsProps {
  adapter: HarnessAgentAdapter | 'unknown'
  modelLabel: string | null
  reasoningEffort: string | null
  /** Retained for upstream callers; per-adapter availability is now
   *  signalled via the runtime control panel, not this row chip. */
  adapterHealth?: AgentAdapterHealth | null
}

/** Adapter / model / reasoning summary line on an agent row. */
export const AgentSummaryChips: FC<AgentSummaryChipsProps> = ({
  adapter,
  modelLabel,
  reasoningEffort,
}) => {
  const parts = [adapterLabel(adapter)]
  if (modelLabel) parts.push(modelLabel)
  if (reasoningEffort) parts.push(reasoningEffort)
  return (
    <div className="flex items-center gap-1.5 text-muted-foreground text-xs">
      <span className="truncate">{parts.join(' · ')}</span>
    </div>
  )
}
