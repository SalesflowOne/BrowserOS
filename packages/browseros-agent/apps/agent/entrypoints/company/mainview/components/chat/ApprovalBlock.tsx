import {
  type ApprovalRow,
  useResolveApproval,
} from '@company/modules/api/approvals.hooks'
import { toastError } from '@company/modules/api/errorToast'
import { Check, X } from 'lucide-react'
import type { FC } from 'react'

// Inline approval surface — replaces the dedicated ApprovalCard now that
// approvals live inside the tool card they gate.
export const ApprovalBlock: FC<{ approval: ApprovalRow }> = ({ approval }) => {
  const resolve = useResolveApproval()
  const decided = approval.status !== 'pending'
  const onDecide = async (status: 'approved' | 'rejected') => {
    try {
      await resolve.mutateAsync({ id: approval.id, status })
    } catch (err) {
      toastError(err, 'Could not resolve approval')
    }
  }
  return (
    <div className="space-y-3 p-4">
      <p className="text-muted-foreground text-sm">{approval.detail}</p>
      {approval.payload ? (
        <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded-md bg-muted/40 p-3 font-mono text-[12px] text-foreground/90 leading-[1.55] ring-1 ring-border/40">
          {approval.payload}
        </pre>
      ) : null}
      {decided ? (
        <p className="text-muted-foreground/80 text-xs">
          {approval.status === 'approved'
            ? 'You approved this. The agent has carried it out.'
            : approval.status === 'rejected'
              ? 'You rejected this. The agent will not proceed.'
              : 'This approval was cancelled.'}
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onDecide('approved')}
            disabled={resolve.isPending}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[color:var(--accent-orange)] px-3 py-1.5 font-medium text-[13px] text-white transition-colors hover:bg-[color:var(--accent-orange)]/90 disabled:opacity-60"
          >
            <Check className="size-3.5" />
            Approve
          </button>
          <button
            type="button"
            onClick={() => onDecide('rejected')}
            disabled={resolve.isPending}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border/70 bg-card px-3 py-1.5 font-medium text-[13px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-60"
          >
            <X className="size-3.5" />
            Reject
          </button>
          <span className="ml-auto text-[11px] text-muted-foreground/70">
            Approve to let them execute · Reject to stop
          </span>
        </div>
      )}
    </div>
  )
}
