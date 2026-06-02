import { Badge } from '@company/components/ui/badge'
import { formatClockTime } from '@company/lib/dateTime'
import { useSmoothStream } from '@company/lib/useSmoothStream'
import type {
  ChatTurn,
  MessagePart,
  ReasoningPart,
  TextPart,
} from '@company/modules/api/threadEventStream'
import { type FC, memo } from 'react'
import {
  Message,
  MessageContent,
  MessageResponse,
} from '../ai-elements/message'
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from '../ai-elements/reasoning'
import { AssistantRow, type EmployeeFace } from './AssistantRow'
import { ConnectAppCard } from './ConnectAppCard'
import { AssistantMeta, ErrorBlock } from './MessageMeta'
import { PermissionApprovalCard } from './PermissionApprovalCard'
import { ToolPartView } from './ToolPartView'

interface Props {
  turn: ChatTurn
  employee: EmployeeFace
  // Threaded through so a ConnectAppCard inside this turn can call
  // useSendThreadMessage with the correct id when the user finishes
  // an OAuth or API-key flow.
  threadId: string
  // True only for the live turn (or, when there's no live turn, the
  // last history entry). Older turns render their connect cards in
  // the 'resolved' phase so scrollback can't re-trigger a stale flow.
  isLastTurn: boolean
}

// React.memo skips re-rendering when both props are reference-equal.
// `turn` only gets a new reference when the reducer in
// useThreadEventStream actually mutates that turn (the live one during
// streaming, never the history entries). `employee` is memoized at the
// ChatSurface call-site. Per-row approval state is read internally via
// useApprovalById, not passed as a prop, so an approvals refetch can't
// invalidate this memo for unrelated rows. Net effect: each text.delta
// only re-renders the live turn's row, not the whole history.
export const ChatMessageRow = memo(function ChatMessageRow({
  turn,
  employee,
  threadId,
  isLastTurn,
}: Props) {
  const firstAssistantPartIdx = turn.parts.findIndex((p) => p.kind !== 'tool')
  // Always render the meta when there's something assistant-side to
  // anchor: any emitted part, an error message, or a cancel that fired
  // before any deltas landed (interrupt hit between turn.start and the
  // first text.delta). Without the cancelled branch, those very-fast
  // interrupts render an entirely empty assistant row with no badge.
  const hasAssistantSurface =
    turn.parts.length > 0 ||
    turn.status === 'cancelled' ||
    (turn.status === 'error' && Boolean(turn.errorMessage))
  return (
    <div
      className="flex flex-col gap-3 transition-colors"
      // `data-turn-id` is the anchor the search palette's deep-link
      // uses. ChatSurface reads `?msg=<requestId>` after history
      // hydrates and scrolls the matching row into view, applying
      // `data-just-jumped` briefly for a pulse highlight.
      data-turn-id={turn.requestId}
    >
      {turn.userMessage ? (
        <div className="flex flex-col items-end gap-1">
          <Message from="user">
            <MessageContent>
              {/* User messages never stream — keep Streamdown in static
                  mode so it skips useTransition + parseIncompleteMarkdown
                  on mount and on every memo-bust. */}
              <MessageResponse mode="static">
                {turn.userMessage}
              </MessageResponse>
            </MessageContent>
          </Message>
          <span className="px-2 text-[10px] text-muted-foreground/60 tabular-nums">
            {formatClockTime(turn.startedAt)}
          </span>
        </div>
      ) : null}
      {hasAssistantSurface ? (
        <AssistantMeta turn={turn} fallbackName={employee.name} />
      ) : null}
      {turn.parts.map((part, idx) => (
        <PartView
          key={part.id}
          part={part}
          streaming={turn.status === 'streaming'}
          employee={employee}
          showAvatar={idx === firstAssistantPartIdx}
          threadId={threadId}
          isLastTurn={isLastTurn}
        />
      ))}
      {turn.status === 'error' && turn.errorMessage ? (
        <AssistantRow
          employee={employee}
          showAvatar={firstAssistantPartIdx < 0}
        >
          <ErrorBlock
            message={turn.errorMessage}
            code={turn.errorCode}
            details={turn.errorDetails}
          />
        </AssistantRow>
      ) : null}
    </div>
  )
})

interface PartProps {
  part: MessagePart
  streaming: boolean
  employee: EmployeeFace
  showAvatar: boolean
  threadId: string
  isLastTurn: boolean
}

// Memoized so a delta on one part doesn't re-render the others. The
// SSE reducer's `withDelta`/`withToolResult`/etc. all preserve the ref
// of any part they didn't touch (Array.prototype.map returns the same
// element ref when the predicate is false), so unchanged parts skip
// here and only the part that actually mutated walks its subtree.
// Biggest win on tool-heavy turns where text streams alongside a half
// dozen tool calls — only the text part re-parses Streamdown per tick.
const PartView = memo(function PartView({
  part,
  streaming,
  employee,
  showAvatar,
  threadId,
  isLastTurn,
}: PartProps) {
  if (part.kind === 'text') {
    return (
      <TextPartView part={part} employee={employee} showAvatar={showAvatar} />
    )
  }
  if (part.kind === 'reasoning') {
    return (
      <ReasoningPartView
        part={part}
        streaming={streaming && !part.ended}
        employee={employee}
        showAvatar={showAvatar}
      />
    )
  }
  if (part.kind === 'mcp-connect') {
    return (
      <AssistantRow employee={employee} showAvatar={showAvatar}>
        <ConnectAppCard
          threadId={threadId}
          toolkit={part.toolkit}
          reason={part.reason}
          isLastTurn={isLastTurn}
        />
      </AssistantRow>
    )
  }
  if (part.kind === 'permission') {
    return (
      <AssistantRow employee={employee} showAvatar={showAvatar}>
        <PermissionApprovalCard threadId={threadId} part={part} />
      </AssistantRow>
    )
  }
  return <ToolPartView part={part} messageIsStreaming={streaming} />
})

const TextPartView: FC<{
  part: TextPart
  employee: EmployeeFace
  showAvatar: boolean
}> = ({ part, employee, showAvatar }) => {
  // The server forwards model output in ~100-char chunks every ~250ms
  // (ACP wrapper batching). Rendered raw, each chunk lands in the DOM
  // all at once → text appears in abrupt steps and the scroll jumps
  // 3-4 lines per tick. `useSmoothStream` turns that into a per-frame
  // typewriter so the DOM grows a few chars per frame instead of in
  // bursts — fixes both the visible chunk-block and the scroll jerk
  // in one go. Bypassed (returns target as-is) once `part.ended`
  // flips so history loads pay no smoothing cost.
  const text = useSmoothStream(part.text, { active: !part.ended })
  return (
    <AssistantRow employee={employee} showAvatar={showAvatar}>
      <Message from="assistant" className="max-w-full">
        <MessageContent>
          {/* `part.ended` flips to true the moment text.end lands.
              After that there are no further deltas for this block —
              switch Streamdown to static mode so it stops paying for
              the transition + incomplete-markdown machinery it no
              longer needs. */}
          <MessageResponse mode={part.ended ? 'static' : 'streaming'}>
            {text || '…'}
          </MessageResponse>
        </MessageContent>
      </Message>
    </AssistantRow>
  )
}

const ReasoningPartView: FC<{
  part: ReasoningPart
  streaming: boolean
  employee: EmployeeFace
  showAvatar: boolean
}> = ({ part, streaming, employee, showAvatar }) => {
  const text = useSmoothStream(part.text, { active: !part.ended })
  return (
    <AssistantRow employee={employee} showAvatar={showAvatar}>
      <Reasoning className="w-full" isStreaming={streaming}>
        <div className="flex items-center gap-2">
          <ReasoningTrigger />
          {part.isPlan ? (
            <Badge variant="secondary" className="h-4 px-1.5 text-[10px]">
              plan
            </Badge>
          ) : null}
        </div>
        <ReasoningContent mode={part.ended ? 'static' : 'streaming'}>
          {text}
        </ReasoningContent>
      </Reasoning>
    </AssistantRow>
  )
}
