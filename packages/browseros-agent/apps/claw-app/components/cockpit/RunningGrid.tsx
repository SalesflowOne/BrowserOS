import { useCancelSession } from '@/modules/api/cancel.hooks'
import { useFocusAgent } from '@/modules/api/focus.hooks'
import type { AgentActivityRecord } from '@/screens/cockpit/cockpit.helpers'
import { AgentRunningCard } from './AgentRunningCard'

interface RunningGridProps {
  agents: AgentActivityRecord[]
}

/** Renders live agent cards and switches to the agent's focus tab on Watch. */
export function RunningGrid({ agents }: RunningGridProps) {
  const focus = useFocusAgent()
  const cancel = useCancelSession()
  const liveCount = agents.filter((a) => a.status === 'active').length

  if (agents.length === 0) return null

  const onWatch = (agent: AgentActivityRecord) => {
    focus.mutate(
      { agentId: agent.agentId, focusUrl: agent.currentFocus.url },
      {
        onError: (err) => {
          // eslint-disable-next-line no-console
          console.warn('focus agent failed', { agentId: agent.agentId, err })
        },
      },
    )
  }
  const onStop = (sessionId: string) => {
    cancel.mutate(
      { sessionId },
      {
        onError: (err) => {
          // eslint-disable-next-line no-console
          console.warn('cancel session failed', { sessionId, err })
        },
      },
    )
  }
  const pendingAgentId =
    focus.isPending && focus.variables ? focus.variables.agentId : null
  const cancelPendingSessionId =
    cancel.isPending && cancel.variables ? cancel.variables.sessionId : null

  return (
    <section className="space-y-4">
      <header className="flex items-baseline gap-3">
        <h2 className="font-semibold text-ink text-lg">Running now</h2>
        <span className="inline-flex items-center gap-1.5 font-mono text-[11px] text-accent uppercase tracking-[0.08em]">
          <span
            aria-hidden
            className="inline-block size-1.5 animate-[pulse-dot_1.4s_ease-in-out_infinite] rounded-full bg-accent shadow-[0_0_8px_hsl(221_90%_55%/0.5)]"
          />
          {liveCount} live
        </span>
      </header>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {agents.map((a) => (
          <AgentRunningCard
            key={a.agentId}
            agent={a}
            onWatch={() => onWatch(a)}
            onStop={
              a.currentFocus.sessionId
                ? () => onStop(a.currentFocus.sessionId as string)
                : undefined
            }
            isFocusPending={pendingAgentId === a.agentId}
            isCancelPending={
              cancelPendingSessionId === a.currentFocus.sessionId
            }
          />
        ))}
      </div>
    </section>
  )
}
