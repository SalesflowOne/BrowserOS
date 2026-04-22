import { ArrowLeft, Bot, History, Home, RotateCcw, Search } from 'lucide-react'
import { type FC, useEffect, useRef } from 'react'
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import {
  type AgentEntry,
  getModelDisplayName,
} from '@/entrypoints/app/agents/useOpenClaw'
import { cn } from '@/lib/utils'
import { useAgentCommandData } from './agent-command-layout'
import { ConversationInput } from './ConversationInput'
import { ConversationMessage } from './ConversationMessage'
import { useAgentConversation } from './useAgentConversation'

function ConversationHeader({
  agentName,
  status,
  onGoHome,
  onReset,
}: {
  agentName: string
  status: string
  onGoHome: () => void
  onReset: () => void
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-border/50 border-b px-6 py-4">
      <div className="flex min-w-0 items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          onClick={onGoHome}
          className="rounded-xl lg:hidden"
          title="Back to home"
        >
          <ArrowLeft className="size-4" />
        </Button>
        <div className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
          <Bot className="size-4.5" />
        </div>
        <div className="min-w-0">
          <div className="truncate font-semibold text-base">{agentName}</div>
          <div className="truncate text-muted-foreground text-sm">{status}</div>
        </div>
      </div>

      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          className="rounded-xl text-muted-foreground"
        >
          <History className="mr-2 size-4" />
          History
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onReset}
          className="rounded-xl text-muted-foreground"
        >
          <RotateCcw className="mr-2 size-4" />
          New conversation
        </Button>
      </div>
    </div>
  )
}

function AgentRail({
  activeAgentId,
  agents,
  onGoHome,
  onSelectAgent,
}: {
  activeAgentId: string
  agents: AgentEntry[]
  onGoHome: () => void
  onSelectAgent: (entry: AgentEntry) => void
}) {
  return (
    <aside className="hidden h-full min-h-0 flex-col border-border/50 border-r bg-background/70 lg:flex">
      <div className="space-y-4 px-4 py-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="flex size-9 items-center justify-center rounded-2xl border border-border/60 bg-card text-muted-foreground">
              <Home className="size-4" />
            </div>
            <div>
              <div className="font-semibold text-sm">Agents</div>
              <div className="text-muted-foreground text-xs">
                Switch conversations
              </div>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={onGoHome}
            className="rounded-xl"
            title="Back to home"
          >
            <Home className="size-4" />
          </Button>
        </div>

        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value=""
            readOnly
            placeholder="Search agents"
            className="rounded-xl border-border/60 bg-card pl-9 text-sm shadow-none"
          />
        </div>
      </div>

      <Separator />

      <div className="styled-scrollbar min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-3">
        {agents.map((entry) => {
          const active = entry.agentId === activeAgentId
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
                <div className="min-w-0">
                  <div className="truncate font-medium text-sm">
                    {entry.name}
                  </div>
                  <div className="truncate text-muted-foreground text-xs">
                    {getModelDisplayName(entry.model) ?? 'OpenClaw agent'}
                  </div>
                </div>
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
  if (streaming) return 'Working on your request'
  if (status === 'running') return 'Ready for the next task'
  if (status === 'starting') return 'Connecting to OpenClaw'
  if (status === 'error') return 'OpenClaw needs attention'
  if (status === 'stopped') return 'OpenClaw is offline'
  return 'Open agent setup to continue'
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
  const { turns, streaming, loading, send, resetConversation } =
    useAgentConversation(resolvedAgentId, agentName)
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
    <div className="absolute inset-0 overflow-hidden bg-background px-4 py-4">
      <div className="mx-auto grid h-full w-full max-w-[1600px] lg:grid-cols-[300px_minmax(0,1fr)]">
        <AgentRail
          activeAgentId={resolvedAgentId}
          agents={agents}
          onGoHome={() => navigate('/home')}
          onSelectAgent={handleSelectAgent}
        />

        <div className="flex min-h-0 flex-col overflow-hidden">
          <ConversationHeader
            agentName={agentName}
            status={statusCopy}
            onGoHome={() => navigate('/home')}
            onReset={resetConversation}
          />

          <main
            ref={scrollRef}
            className={cn(
              'styled-scrollbar min-h-0 flex-1 overflow-y-auto overflow-x-hidden bg-background px-6 py-6',
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
              <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
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

          <div className="border-border/50 border-t bg-card/90 px-4 py-4">
            <div className="mx-auto max-w-4xl">
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
