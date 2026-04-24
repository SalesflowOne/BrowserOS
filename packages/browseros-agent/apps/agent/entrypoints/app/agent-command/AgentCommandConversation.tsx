import { ArrowLeft, Bot, Home, RotateCcw } from 'lucide-react'
import { type FC, useEffect, useRef } from 'react'
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router'
import { Button } from '@/components/ui/button'
import type { AgentEntry } from '@/entrypoints/app/agents/useOpenClaw'
import { cn } from '@/lib/utils'
import { useAgentCommandData } from './agent-command-layout'
import { ConversationInput } from './ConversationInput'
import { ConversationMessage } from './ConversationMessage'
import { useAgentConversation } from './useAgentConversation'

type ConversationVariant = 'command' | 'page'

// Page routes render inside SidebarLayout's py-8 content frame.
const PAGE_FRAME_HEIGHT_CLASS = 'h-[calc(100dvh-4rem)] min-h-[620px]'

function ConversationHeader({
  agentName,
  backLabel,
  variant,
  status,
  onNavigateBack,
  onReset,
}: {
  agentName: string
  backLabel: string
  variant: ConversationVariant
  status: string
  onNavigateBack: () => void
  onReset: () => void
}) {
  const BackIcon = variant === 'command' ? Home : ArrowLeft

  return (
    <div className="overflow-hidden rounded-[1.5rem] border border-border/60 bg-card/95 shadow-sm backdrop-blur">
      <div className="flex items-center justify-between gap-3 px-5 py-4">
        <div className="flex min-w-0 items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={onNavigateBack}
            className="rounded-xl"
            title={backLabel}
          >
            <BackIcon className="size-4" />
          </Button>
          <div className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
            <Bot className="size-5" />
          </div>
          <div className="min-w-0">
            <div className="truncate font-semibold text-sm">{agentName}</div>
            <div className="truncate text-muted-foreground text-sm">
              {status}
            </div>
          </div>
        </div>
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

function EmptyConversationState({ agentName }: { agentName: string }) {
  return (
    <div className="flex min-h-full items-center justify-center py-10">
      <div className="max-w-md rounded-[1.5rem] border border-border/60 bg-card/90 px-8 py-10 text-center shadow-sm backdrop-blur">
        <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
          <Bot className="size-6" />
        </div>
        <h2 className="mt-4 font-semibold text-lg">{agentName}</h2>
        <p className="mt-2 text-muted-foreground text-sm">
          Send a message to start a focused conversation with this agent.
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

interface AgentCommandConversationProps {
  variant?: ConversationVariant
  backPath?: string
  agentPathPrefix?: string
  createAgentPath?: string
}

export const AgentCommandConversation: FC<AgentCommandConversationProps> = ({
  variant = 'command',
  backPath = '/home',
  agentPathPrefix = '/home/agents',
  createAgentPath = '/agents',
}) => {
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
  const isPageVariant = variant === 'page'
  const backLabel = isPageVariant ? 'Back to agents' : 'Back to home'

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
    return <Navigate to={backPath} replace />
  }

  const handleSelectAgent = (entry: AgentEntry) => {
    navigate(`${agentPathPrefix}/${entry.agentId}`)
  }

  const statusCopy = getConversationStatusCopy(status?.status, streaming)

  return (
    <div
      className={cn(
        'overflow-hidden',
        isPageVariant ? PAGE_FRAME_HEIGHT_CLASS : 'absolute inset-0',
      )}
    >
      <div
        className={cn(
          'fade-in slide-in-from-bottom-5 flex h-full w-full animate-in flex-col gap-3 duration-300',
          isPageVariant
            ? 'mx-auto max-w-3xl'
            : 'mx-auto max-w-3xl px-4 pt-4 pb-2',
        )}
      >
        <ConversationHeader
          agentName={agentName}
          backLabel={backLabel}
          variant={variant}
          status={statusCopy}
          onNavigateBack={() => navigate(backPath)}
          onReset={resetConversation}
        />

        <main
          ref={scrollRef}
          className={cn(
            'styled-scrollbar min-h-0 flex-1 overflow-y-auto overflow-x-hidden rounded-[1.5rem] border border-border/50 bg-card/85 px-5 py-5 shadow-sm',
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
            <div className="w-full space-y-4">
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

        <div className="w-full flex-shrink-0">
          <ConversationInput
            variant="conversation"
            agents={agents}
            selectedAgentId={resolvedAgentId}
            onSelectAgent={handleSelectAgent}
            onSend={(text) => {
              void send(text)
            }}
            onCreateAgent={() => navigate(createAgentPath)}
            streaming={streaming}
            disabled={status?.status !== 'running'}
            status={status?.status}
            placeholder={`Message ${agentName}...`}
          />
        </div>
      </div>
    </div>
  )
}
