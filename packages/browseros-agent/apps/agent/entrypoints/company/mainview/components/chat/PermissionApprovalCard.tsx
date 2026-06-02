import { Badge } from '@company/components/ui/badge'
import { Button } from '@company/components/ui/button'
import { cn } from '@company/lib/utils'
import { toastError } from '@company/modules/api/errorToast'
import { useResolvePermission } from '@company/modules/api/permission-modes.hooks'
import {
  Ban,
  Brain,
  Check,
  Eye,
  FileEdit,
  FolderInput,
  Repeat,
  Search,
  Trash2,
  TriangleAlert,
  X,
} from 'lucide-react'
import { type FC, useState } from 'react'
import type {
  PermissionDecision,
  PermissionOutcome,
  PermissionToolKind,
} from '../../../shared/permission'
import type { PermissionPart } from '../../modules/api/threadEventStream'

interface PermissionApprovalCardProps {
  threadId: string
  part: PermissionPart
}

export const PermissionApprovalCard: FC<PermissionApprovalCardProps> = ({
  threadId,
  part,
}) => {
  // Auto-resolved decisions (mode short-circuited; no card was ever
  // pending) render as a one-line breadcrumb so the transcript doesn't
  // get spammed with full cards under allow-all / read-only modes.
  if (part.state === 'resolved' && part.resolvedBy === 'auto') {
    return <AutoResolvedBreadcrumb part={part} />
  }
  if (part.state === 'resolved') {
    return <ResolvedCard part={part} />
  }
  return <PendingCard threadId={threadId} part={part} />
}

const PendingCard: FC<{ threadId: string; part: PermissionPart }> = ({
  threadId,
  part,
}) => {
  const resolve = useResolvePermission()
  // Disable all buttons after the first click — guards against
  // double-fire and against the user mashing two outcomes in quick
  // succession. The server-side registry resolves the first; the
  // second would 409 anyway, but disabling avoids the toast.
  const [submitting, setSubmitting] = useState(false)
  const onClick = (outcome: PermissionDecision) => async () => {
    if (submitting) return
    setSubmitting(true)
    try {
      await resolve.mutateAsync({
        threadId,
        requestId: part.id,
        outcome,
      })
    } catch (err) {
      toastError(err, 'Could not resolve permission')
      // Clear the local guard so the user can retry without reloading.
      setSubmitting(false)
    }
  }
  const KindIcon = kindIcon(part.toolKind)
  return (
    <div className="my-2 flex flex-col gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3">
      <div className="flex items-start gap-2">
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-500" />
        <div className="flex flex-1 flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="font-medium text-amber-700 text-sm dark:text-amber-400">
              Permission requested
            </span>
            {part.toolKind ? (
              <Badge variant="outline" className="font-mono text-[10px]">
                <KindIcon className="size-3" />
                {part.toolKind}
              </Badge>
            ) : null}
          </div>
          <p className="font-mono text-muted-foreground text-xs">
            Allow <span className="text-foreground">{part.toolName}</span>?
          </p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={onClick('reject_once')}
          disabled={submitting}
        >
          <X className="size-3.5" />
          Deny
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={onClick('reject_always')}
          disabled={submitting}
        >
          <Ban className="size-3.5" />
          Deny — don't ask again
        </Button>
        <Button size="sm" onClick={onClick('allow_once')} disabled={submitting}>
          <Check className="size-3.5" />
          Approve
        </Button>
        <Button
          size="sm"
          onClick={onClick('allow_always')}
          disabled={submitting}
        >
          <Check className="size-3.5" />
          Approve — don't ask again
        </Button>
      </div>
    </div>
  )
}

const ResolvedCard: FC<{ part: PermissionPart }> = ({ part }) => {
  const { tone, Icon, label } = describeOutcome(part.outcome, part.resolvedBy)
  return (
    <div
      className={cn(
        'my-2 flex items-center gap-2 rounded-md border px-3 py-2 text-xs',
        tone === 'allow' && 'border-border bg-muted/40 text-muted-foreground',
        tone === 'deny' &&
          'border-destructive/30 bg-destructive/5 text-destructive',
        tone === 'cancel' && 'border-border bg-muted/40 text-muted-foreground',
      )}
    >
      <Icon className="size-3.5 shrink-0" />
      <span className="flex-1 leading-relaxed">
        {label} <span className="font-mono">{part.toolName}</span>
      </span>
    </div>
  )
}

const AutoResolvedBreadcrumb: FC<{ part: PermissionPart }> = ({ part }) => {
  // outcome can be undefined on the late-arrival materialise path
  // (permission.resolved arrives without a matching permission.
  // request — happens on partial replay windows). Tri-state the
  // visual so we don't silently flip the icon + label to "denied"
  // when the truth is "we don't know yet".
  const allowed = part.outcome ? part.outcome.startsWith('allow') : null
  const Icon = allowed === true ? Check : allowed === false ? X : Ban
  const label =
    allowed === null ? 'Resolved' : `Auto-${allowed ? 'approved' : 'denied'}`
  return (
    <div className="my-1 flex items-center gap-2 px-1 text-[11px] text-muted-foreground">
      <Icon className="size-3" />
      <span className="leading-relaxed">
        {label} <span className="font-mono">{part.toolName}</span>
        {part.toolKind ? (
          <span className="text-muted-foreground/60"> · {part.toolKind}</span>
        ) : null}
      </span>
    </div>
  )
}

function describeOutcome(
  outcome: PermissionOutcome | undefined,
  resolvedBy: PermissionPart['resolvedBy'],
): {
  tone: 'allow' | 'deny' | 'cancel'
  Icon: typeof Check
  label: string
} {
  if (resolvedBy === 'cancel' || outcome === 'cancel') {
    return { tone: 'cancel', Icon: Ban, label: 'Cancelled' }
  }
  switch (outcome) {
    case 'allow_once':
      return { tone: 'allow', Icon: Check, label: 'Approved' }
    case 'allow_always':
      return {
        tone: 'allow',
        Icon: Check,
        label: 'Approved + remembered for this thread —',
      }
    case 'reject_once':
      return { tone: 'deny', Icon: X, label: 'Denied' }
    case 'reject_always':
      return {
        tone: 'deny',
        Icon: X,
        label: 'Denied + remembered for this thread —',
      }
    default:
      return { tone: 'cancel', Icon: Ban, label: 'Resolved' }
  }
}

function kindIcon(kind: PermissionToolKind | null): typeof Check {
  switch (kind) {
    case 'read':
      return Eye
    case 'search':
    case 'fetch':
      return Search
    case 'edit':
      return FileEdit
    case 'execute':
      return TriangleAlert
    case 'delete':
      return Trash2
    case 'move':
      return FolderInput
    case 'switch_mode':
      return Repeat
    case 'think':
      return Brain
    default:
      return TriangleAlert
  }
}
