import { Avatar } from '@company/components/chat/Avatar'
import { formatAbsoluteDate, formatRelativeLong } from '@company/lib/dateTime'
import type { Tint } from '@company/lib/tints'
import type { Status } from '@company/lib/types'
import { cn } from '@company/lib/utils'
import {
  type AgentDetection,
  useAvailableAgents,
} from '@company/modules/api/agents.hooks'
import {
  type Employee,
  useEmployee,
  useFireEmployee,
} from '@company/modules/api/employees.hooks'
import { toastError } from '@company/modules/api/errorToast'
import { Link, useNavigate } from '@tanstack/react-router'
import { Check, Copy, Trash2, X } from 'lucide-react'
import { type FC, type ReactNode, useState } from 'react'
import { toast } from 'sonner'

interface Props {
  employee: Employee
  onClose: () => void
}

const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000

export const DetailsPane: FC<Props> = ({ employee, onClose }) => {
  const navigate = useNavigate()
  const fire = useFireEmployee()

  const onFire = async () => {
    if (!confirm(`Fire ${employee.name}? Their threads stay intact.`)) {
      return
    }
    try {
      await fire.mutateAsync({ id: employee.id })
      void navigate({ to: '/org' })
    } catch (err) {
      toastError(err, 'Could not fire')
    }
  }

  return (
    <aside className="hidden h-full min-h-0 flex-col overflow-hidden border-border/50 border-l bg-card/30 xl:flex">
      <header className="flex h-12 shrink-0 items-center justify-between gap-2 border-border/50 border-b px-4">
        <p className="font-mono text-[10.5px] text-muted-foreground/80 uppercase tracking-[0.14em]">
          Details
        </p>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close details"
          className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-accent hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <section className="flex flex-col items-center gap-3 px-5 py-6 text-center">
          <Avatar
            monogram={employee.monogram}
            tint={employee.tint as Tint}
            status={employee.status as Status}
            size="lg"
            className="size-16"
          />
          <div>
            <h2 className="font-semibold text-[17px] text-foreground leading-tight">
              {employee.name}
            </h2>
            <p className="mt-0.5 text-[12.5px] text-muted-foreground">
              {employee.role}
            </p>
          </div>
          {employee.bio || employee.tagline ? (
            <p className="max-w-[28ch] text-[12.5px] text-foreground/80 leading-[1.55]">
              {employee.bio || employee.tagline}
            </p>
          ) : null}
        </section>

        <Divider />

        <section className="px-5 py-4">
          <DetailRow label="Status">
            <StatusPill status={employee.status as Status} />
          </DetailRow>
          <DetailRow label="Reports to">
            <ManagerName employee={employee} />
          </DetailRow>
          <DetailRow label="Hired">
            <span className="text-[12.5px] text-foreground">
              {formatAbsoluteDate(employee.hiredAt)}
              {Date.now() - employee.hiredAt < SEVEN_DAYS ? (
                <span className="ml-1.5 text-muted-foreground/70">
                  · {formatRelativeLong(employee.hiredAt)}
                </span>
              ) : null}
            </span>
          </DetailRow>
        </section>

        <Divider />

        <section className="px-5 py-4">
          <DetailRow label="Powered by">
            <PoweredBy employee={employee} />
          </DetailRow>
          <DetailRow label="Workspace">
            <WorkspacePath path={employee.workspacePath} />
          </DetailRow>
        </section>
      </div>

      <footer className="shrink-0 border-border/50 border-t px-5 py-3">
        <button
          type="button"
          onClick={onFire}
          className="inline-flex w-full items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-[12px] text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
        >
          <Trash2 className="size-3" />
          Let {employee.name.split(' ')[0]} go
        </button>
      </footer>
    </aside>
  )
}

const DetailRow: FC<{ label: string; children: ReactNode }> = ({
  label,
  children,
}) => (
  <div className="flex items-center justify-between gap-2 py-1.5">
    <span className="font-mono text-[10px] text-muted-foreground/70 uppercase tracking-[0.14em]">
      {label}
    </span>
    {children}
  </div>
)

const Divider: FC = () => <div className="border-border/40 border-t" />

const StatusPill: FC<{ status: Status }> = ({ status }) => (
  <span
    className={cn(
      'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-mono text-[10.5px] uppercase tracking-[0.14em]',
      status === 'working'
        ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
        : 'bg-muted text-muted-foreground',
    )}
  >
    <span
      className={cn(
        'inline-block size-1.5 rounded-full',
        status === 'working' ? 'bg-emerald-500' : 'bg-muted-foreground/60',
      )}
    />
    {status}
  </span>
)

const PoweredBy: FC<{ employee: Employee }> = ({ employee }) => {
  const agents = useAvailableAgents()
  const detection = (agents.data ?? []).find(
    (a) => a.agentId === employee.agentKind,
  )
  const label = detection?.displayName ?? employee.agentKind
  // The chip needs to distinguish "no answer yet" (loading/error) from
  // "definitely no entry" (loaded successfully with the id absent) —
  // otherwise a transient query failure looks identical to the agent
  // being uninstalled and points the founder at the wrong fix.
  const unresolved = agents.isLoading || agents.isError
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <span className="truncate text-[12.5px] text-foreground">{label}</span>
      <AgentStateChip detection={detection} unresolved={unresolved} />
    </span>
  )
}

const AgentStateChip: FC<{
  detection: AgentDetection | undefined
  unresolved: boolean
}> = ({ detection, unresolved }) => {
  if (!detection && unresolved) {
    return (
      <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
        …
      </span>
    )
  }
  if (!detection || detection.installState === 'not-installed') {
    return (
      <span className="rounded-md bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-700 dark:text-amber-400">
        not detected
      </span>
    )
  }
  if (detection.installState === 'npx-available') {
    return (
      <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
        via npx
      </span>
    )
  }
  return (
    <span className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
      {detection.version ?? 'installed'}
    </span>
  )
}

const WorkspacePath: FC<{ path: string | null }> = ({ path }) => {
  const [copied, setCopied] = useState(false)
  if (!path) {
    return <span className="text-[12.5px] text-muted-foreground">—</span>
  }

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(path)
      setCopied(true)
      toast.success('Workspace path copied')
      setTimeout(() => setCopied(false), 1_500)
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Could not copy workspace path',
      )
    }
  }

  return (
    <span className="inline-flex min-w-0 max-w-full items-start gap-1.5">
      <span className="min-w-0 break-all text-right font-mono text-[11.5px] text-muted-foreground">
        {path}
      </span>
      <button
        type="button"
        onClick={onCopy}
        aria-label="Copy workspace path"
        className={cn(
          'inline-flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground/70 transition-colors hover:bg-accent hover:text-foreground',
          copied && 'text-[color:var(--accent-orange)]',
        )}
      >
        {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
      </button>
    </span>
  )
}

const ManagerName: FC<{ employee: Employee }> = ({ employee }) => {
  const managerId = employee.managerId
  const manager = useEmployee({
    variables: { id: managerId ?? '' },
    enabled: managerId !== null,
  })
  if (managerId === null) {
    return <span className="text-[12.5px] text-foreground">You</span>
  }
  if (!manager.data) {
    return <span className="text-[12.5px] text-muted-foreground">—</span>
  }
  return (
    <Link
      to="/e/$employeeId/t/$threadId"
      params={{ employeeId: manager.data.id, threadId: 'general' }}
      className="inline-flex items-center gap-1.5 rounded-md px-1 py-0.5 text-[12.5px] text-foreground transition-colors hover:bg-accent/40"
    >
      <Avatar
        monogram={manager.data.monogram}
        tint={manager.data.tint as Tint}
        size="xs"
      />
      <span>{manager.data.name}</span>
    </Link>
  )
}
