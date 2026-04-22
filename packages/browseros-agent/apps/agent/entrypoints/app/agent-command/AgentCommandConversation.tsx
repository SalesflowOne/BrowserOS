import { ArrowLeft, Bot } from 'lucide-react'
import { type FC, useEffect, useRef } from 'react'
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router'
import { Button } from '@/components/ui/button'
import {
  type AgentEntry,
  getModelDisplayName,
} from '@/entrypoints/app/agents/useOpenClaw'
import { cn } from '@/lib/utils'
import { useAgentCommandData } from './agent-command-layout'
import { ConversationInput } from './ConversationInput'
import { ConversationMessage } from './ConversationMessage'
import { useAgentConversation } from './useAgentConversation'

function StatusBadge({ status }: { status: string }) {
  return (
    <div className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-card px-3 py-1 text-[11px] text-muted-foreground uppercase tracking-[0.18em]">
      <span
        className={cn(
          'size-1.5 rounded-full',
          status === 'Working on your request'
            ? 'bg-amber-500'
            : status === 'Ready'
              ? 'bg-emerald-500'
              : status === 'Offline'
                ? 'bg-muted-foreground/50'
                : 'bg-[var(--accent-orange)]',
        )}
      />
      <span>{status}</span>
    </div>
  )
}

function AgentIdentity({
  name,
  meta,
  className,
}: {
  name: string
  meta: string
  className?: string
}) {
  return (
    <div className={cn('min-w-0', className)}>
      <div className="truncate font-semibold text-[15px] leading-5">{name}</div>
      <div className="truncate text-muted-foreground text-xs leading-5">
        {meta}
      </div>
    </div>
  )
}

function ConversationHeader({
  agentName,
  agentMeta,
  status,
  onGoHome,
}: {
  agentName: string
  agentMeta: string
  status: string
  onGoHome: () => void
}) {
  return (
    <div className="flex h-16 items-center justify-between gap-4 border-border/50 border-b px-5">
      <div className="flex min-w-0 items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          onClick={onGoHome}
          className="size-8 rounded-xl lg:hidden"
          title="Back to home"
        >
          <ArrowLeft className="size-4" />
        </Button>
        <div className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
          <Bot className="size-4" />
        </div>
        <AgentIdentity name={agentName} meta={agentMeta} />
      </div>

      <StatusBadge status={status} />
    </div>
  )
}

function AgentRailHeader({ onGoHome }: { onGoHome: () => void }) {
  return (
    <div className="hidden h-16 items-center border-border/50 border-r border-b bg-background/70 px-4 lg:flex">
      <div className="flex min-w-0 items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          onClick={onGoHome}
          className="size-8 rounded-xl"
          title="Back to home"
        >
          <ArrowLeft className="size-4" />
        </Button>
        <div className="truncate font-semibold text-[15px] leading-5">
          Agents
        </div>
      </div>
    </div>
  )
}

function AgentRailList({
  activeAgentId,
  agents,
  onSelectAgent,
}: {
  activeAgentId: string
  agents: AgentEntry[]
  onSelectAgent: (entry: AgentEntry) => void
}) {
  return (
    <aside className="hidden min-h-0 flex-col border-border/50 border-r bg-background/70 lg:flex">
      <div className="styled-scrollbar min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-3">
        {agents.map((entry) => {
          const active = entry.agentId === activeAgentId
          const modelName = getModelDisplayName(entry.model) ?? 'OpenClaw agent'

          return (
            <button
              key={entry.agentId}
              type="button"
              onClick={() => onSelectAgent(entry)}
              className={cn(
                'w-full rounded-2xl border px-3 py-3 text-left transition-all',
                active
                  ? 'border-[var(--accent-orange)]/30 bg-[var(--accent-orange)]/8 shadow-sm'
                  : 'border-transparent bg-transparent hover:border-border/60 hover:bg-card',
              )}
            >
              <div className="flex items-center gap-3">
                <div
                  className={cn(
                    'flex size-9 items-center justify-center rounded-xl',
                    active
                      ? 'bg-[var(--accent-orange)]/12 text-[var(--accent-orange)]'
                      : 'bg-muted text-muted-foreground',
                  )}
                >
                  <Bot className="size-4" />
                </div>
                <AgentIdentity name={entry.name} meta={modelName} />
              </div>
            </button>
          )
        })}
      </div>
    </aside>
  )
}

function EmptyConversationState({ agentName }: { agentName: string }) {
  return (
    <div className="flex h-full items-center justify-center px-6 py-12">
      <div className="max-w-md text-center">
        <div className="mx-auto flex size-14 items-center justify-center rounded-3xl bg-muted text-muted-foreground">
          <Bot className="size-6" />
        </div>
        <h2 className="mt-5 font-semibold text-xl">{agentName}</h2>
        <p className="mt-2 text-muted-foreground text-sm leading-6">
          Start a new conversation when you are ready.
        </p>
      </div>
    </div>
  )
}

function getConversationStatusCopy(
  status: string | undefined,
  streaming: boolean,
): string {
  if (streaming) return 'Working'
  if (status === 'running') return 'Ready'
  if (status === 'starting') return 'Connecting'
  if (status === 'error') return 'Attention'
  if (status === 'stopped') return 'Offline'
  return 'Setup'
}

export const AgentCommandConversation: FC = () => {
  const { agentId } = useParams<{ agentId: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const scrollRef = useRef<HTMLDivElement>(null)
  const initialQuerySent = useRef(false)
  const { status, agents } = useAgentCommandData()
  const shouldRedirectHome = !agentId
  const resolvedAgentId = agentId ?? ''
  const agent = agents.find((entry) => entry.agentId === resolvedAgentId)
  const agentName = agent?.name || resolvedAgentId || 'Agent'
  const agentMeta = getModelDisplayName(agent?.model) ?? 'OpenClaw agent'
  const { turns, streaming, loading, send } = useAgentConversation(
    resolvedAgentId,
    agentName,
  )
  const lastTurn = turns[turns.length - 1]
  const lastTurnPartCount = lastTurn?.parts.length ?? 0

  useEffect(() => {
    if (shouldRedirectHome) return

    const query = searchParams.get('q')
    if (query && !initialQuerySent.current && !loading) {
      initialQuerySent.current = true
      setSearchParams({}, { replace: true })
      void send(query)
    }
  }, [loading, searchParams, send, setSearchParams, shouldRedirectHome])

  useEffect(() => {
    if (
      shouldRedirectHome ||
      (turns.length === 0 && lastTurnPartCount === 0 && !streaming)
    ) {
      return
    }

    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: 'smooth',
    })
  }, [lastTurnPartCount, shouldRedirectHome, streaming, turns.length])

  if (shouldRedirectHome) {
    return <Navigate to="/home" replace />
  }

  const handleSelectAgent = (entry: AgentEntry) => {
    navigate(`/home/agents/${entry.agentId}`)
  }

  const statusCopy = getConversationStatusCopy(status?.status, streaming)

  return (
    <div className="absolute inset-0 overflow-hidden bg-background md:pl-[theme(spacing.14)]">
      <div className="mx-auto grid h-full w-full max-w-[1480px] lg:grid-cols-[288px_minmax(0,1fr)] lg:grid-rows-[4rem_minmax(0,1fr)]">
        <AgentRailHeader onGoHome={() => navigate('/home')} />

        <ConversationHeader
          agentName={agentName}
          agentMeta={agentMeta}
          status={statusCopy}
          onGoHome={() => navigate('/home')}
        />

        <AgentRailList
          activeAgentId={resolvedAgentId}
          agents={agents}
          onSelectAgent={handleSelectAgent}
        />

        <div className="flex min-h-0 flex-col overflow-hidden">
          <main
            ref={scrollRef}
            className={cn(
              'styled-scrollbar min-h-0 flex-1 overflow-y-auto overflow-x-hidden bg-background px-5 py-5',
              '[&_[data-streamdown="code-block"]]:!max-w-full [&_[data-streamdown="table-wrapper"]]:!max-w-full [&_[data-streamdown="code-block"]]:overflow-x-auto [&_[data-streamdown="table-wrapper"]]:overflow-x-auto',
            )}
          >
            {loading ? (
              <div className="flex h-full items-center justify-center text-muted-foreground text-sm">
                Loading conversation...
              </div>
            ) : turns.length === 0 ? (
              <EmptyConversationState agentName={agentName} />
            ) : (
              <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
                {turns.map((turn, index) => (
                  <ConversationMessage
                    key={turn.id}
                    turn={turn}
                    streaming={streaming && index === turns.length - 1}
                  />
                ))}
              </div>
            )}
          </main>

          <div className="border-border/50 border-t bg-background/88 px-4 py-3 backdrop-blur-md">
            <div className="mx-auto max-w-3xl">
              <ConversationInput
                variant="conversation"
                agents={agents}
                selectedAgentId={resolvedAgentId}
                onSelectAgent={handleSelectAgent}
                onSend={(text) => {
                  void send(text)
                }}
                onCreateAgent={() => navigate('/agents')}
                streaming={streaming}
                disabled={status?.status !== 'running'}
                status={status?.status}
                placeholder={`Message ${agentName}...`}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
