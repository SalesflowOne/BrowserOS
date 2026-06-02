import type { Tint } from '@company/lib/tints'
import { type FC, useEffect, useState } from 'react'
import { Avatar } from './Avatar'
import { selectVerb } from './employee-busy.role-verbs'
import {
  approxTokensFromChars,
  formatElapsed,
  formatTokenCount,
} from './employee-busy.tokens'

const VERB_ROTATE_MS = 10_000
const ELAPSED_TICK_MS = 1_000

interface EmployeeFace {
  name: string
  monogram: string
  tint: Tint
  templateId: string | null
}

interface Props {
  // Single source of truth for "is the indicator on screen?", gated
  // on the live SSE stream in ChatSurface. When false, this component
  // returns null. Includes the post-send pre-turn.start gap so the row
  // appears immediately on submit, not just when the first event lands.
  isStreaming: boolean
  employee: EmployeeFace
  // ms epoch from the turn.start event. Pass 0 when no turn is active;
  // the elapsed cell shows 0s in that case (the component is unmounted
  // anyway because isStreaming gates the render).
  startedAt: number
  // Accumulated text-delta lengths from the SSE reducer. Converted to
  // an approximate token count for the `↓ ~N tok` cell.
  outputChars: number
  // Set by meta.turn-input shortly after turn.start. The input cell is
  // hidden until this lands so the row doesn't grow visually as data
  // fills in.
  inputChars?: number
  // Most-recent unresolved tool name from live.parts (a ToolPart with
  // state: 'input-available'). Null when no tool is mid-call. Swaps
  // the rotating role verb for a tool-aware phrase for as long as the
  // tool is in flight.
  liveToolName: string | null
  // True when a PermissionPart in live.parts is `state: 'pending'`.
  // Highest-precedence verb branch. The agent is paused waiting for
  // the founder, not working.
  paused: boolean
}

// Bottom-of-conversation status row that stays on screen for the
// lifetime of a streaming turn. Renders one of three verb pools by
// precedence: paused > liveToolName > role rotation. Mounts inside
// ConversationContent so the existing auto-scroll pins it.
export const EmployeeBusy: FC<Props> = ({
  isStreaming,
  employee,
  startedAt,
  outputChars,
  inputChars,
  liveToolName,
  paused,
}) => {
  const [verb, setVerb] = useState(() =>
    selectVerb({
      templateId: employee.templateId,
      liveToolName,
      paused,
    }),
  )
  const [elapsed, setElapsed] = useState(0)

  // Re-pick whenever the precedence inputs change. A tool-call landing
  // swaps the verb instantly; the rotation timer below covers the
  // steady-state role cycling.
  useEffect(() => {
    if (isStreaming) {
      setVerb(
        selectVerb({
          templateId: employee.templateId,
          liveToolName,
          paused,
        }),
      )
    }
  }, [isStreaming, liveToolName, paused, employee.templateId])

  // 10s rotation. Pause overlay and tool overlay both freeze the
  // rotation: their verbs are conditional on a discrete state, not
  // ambient activity. When that state resolves, the effect above
  // re-picks immediately so the row never feels stale.
  useEffect(() => {
    if (!isStreaming || liveToolName || paused) return
    const id = setInterval(
      () =>
        setVerb(
          selectVerb({
            templateId: employee.templateId,
            liveToolName: null,
            paused: false,
          }),
        ),
      VERB_ROTATE_MS,
    )
    return () => clearInterval(id)
  }, [isStreaming, liveToolName, paused, employee.templateId])

  // 1s elapsed tick. Resets to 0 whenever the turn changes (new
  // startedAt). Skipped entirely when not streaming to avoid a stray
  // timer leak.
  useEffect(() => {
    if (!isStreaming || !startedAt) {
      setElapsed(0)
      return
    }
    setElapsed(Date.now() - startedAt)
    const id = setInterval(
      () => setElapsed(Date.now() - startedAt),
      ELAPSED_TICK_MS,
    )
    return () => clearInterval(id)
  }, [isStreaming, startedAt])

  if (!isStreaming) return null

  const outTokens = approxTokensFromChars(outputChars)
  const inTokens =
    typeof inputChars === 'number' ? approxTokensFromChars(inputChars) : null

  return (
    // No role/aria-live: this row is decorative chrome for sighted
    // users. The conversation's actual content (new assistant message,
    // streaming text) is what screen readers should announce; layering
    // a polite live region on top with sub-second updates produces
    // constant chatter.
    <div className="flex items-center gap-2 px-1 py-2 text-muted-foreground text-xs tabular-nums">
      <Avatar
        monogram={employee.monogram}
        tint={employee.tint}
        size="xs"
        className="shrink-0"
      />
      <span className="truncate">
        <span className="text-foreground/80">{employee.name}</span> is{' '}
        <span className="italic">{verb}…</span>
      </span>
      <span className="text-muted-foreground/60">·</span>
      <span className="font-mono">{formatElapsed(elapsed)}</span>
      <span className="text-muted-foreground/60">·</span>
      <span className="font-mono">↓ ~{formatTokenCount(outTokens)} tok</span>
      {inTokens !== null ? (
        <>
          <span className="text-muted-foreground/60">·</span>
          <span className="font-mono">↑ ~{formatTokenCount(inTokens)} tok</span>
        </>
      ) : null}
    </div>
  )
}
