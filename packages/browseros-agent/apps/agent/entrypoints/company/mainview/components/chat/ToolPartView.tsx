import type { ApprovalRow } from '@company/modules/api/approvals.hooks'
import { useApprovalById } from '@company/modules/api/approvals.hooks'
import type {
  ToolPart,
  ToolState,
} from '@company/modules/api/threadEventStream'
import { type FC, useState } from 'react'
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from '../ai-elements/tool'
import { ApprovalBlock } from './ApprovalBlock'

function toToolType(toolName: string): `tool-${string}` {
  return `tool-${toolName || 'unknown'}`
}

function toToolUiState(
  part: ToolPart,
  approval: ApprovalRow | undefined,
): ToolState {
  // The reducer's state is event-driven; once the user resolves an
  // approval the badge needs to catch up before the eventual
  // `tool.result` event lands. Read through the approval row when one
  // is attached.
  if (approval && approval.status !== 'pending') {
    return 'approval-responded'
  }
  return part.state
}

export const ToolPartView: FC<{
  part: ToolPart
  messageIsStreaming: boolean
}> = ({ part, messageIsStreaming }) => {
  // useApprovalById subscribes to the approvals query via a select that
  // narrows to this one approval — TanStack's structural sharing means
  // approvals refetches don't trigger a re-render unless THIS row's
  // approval row actually changed. That's what keeps ChatMessageRow's
  // memo intact when other approvals come in.
  const approval = useApprovalById(part.approvalId)

  // autoOpen derives open from props each render; userOverride sticks
  // once the user clicks. Approval-pending forces open because the
  // agent is paused on the Approve / Reject controls. Otherwise gate
  // on messageIsStreaming so a turn that ends with a cancel / error
  // (no tool.result) still collapses the block.
  const isStreamingActive =
    part.state === 'input-streaming' || part.state === 'input-available'
  const autoOpen =
    approval?.status === 'pending' || (isStreamingActive && messageIsStreaming)
  const [userOverride, setUserOverride] = useState<boolean | null>(null)
  const open = userOverride ?? autoOpen

  return (
    <Tool open={open} onOpenChange={setUserOverride}>
      <ToolHeader
        title={approval?.title ?? part.toolName}
        type={toToolType(part.toolName)}
        state={toToolUiState(part, approval)}
      />
      <ToolContent>
        {approval ? (
          <ApprovalBlock approval={approval} />
        ) : (
          <ToolInput input={part.input} />
        )}
        <ToolOutput
          output={part.output}
          errorText={
            part.isError ? String(part.output ?? 'Tool failed') : undefined
          }
        />
      </ToolContent>
    </Tool>
  )
}
