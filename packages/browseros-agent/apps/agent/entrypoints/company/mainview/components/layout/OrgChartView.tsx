import { Avatar } from '@company/components/chat/Avatar'
import type { Tint } from '@company/lib/tints'
import { cn } from '@company/lib/utils'
import {
  type Employee,
  useEmployees,
  useSetEmployeeManager,
} from '@company/modules/api/employees.hooks'
import { toastError } from '@company/modules/api/errorToast'
import { Link } from '@tanstack/react-router'
import { Crown, MessageSquare, Network, Users2 } from 'lucide-react'
import { type FC, useMemo } from 'react'

export const OrgChartView: FC = () => {
  const employees = useEmployees()
  const setManager = useSetEmployeeManager()

  const byManager = useMemo(() => {
    const map = new Map<string | null, Employee[]>()
    for (const e of employees.data ?? []) {
      const key = e.managerId ?? null
      const arr = map.get(key) ?? []
      arr.push(e)
      map.set(key, arr)
    }
    return map
  }, [employees.data])

  const directReports = byManager.get(null) ?? []
  const list = employees.data ?? []

  const onSetManager = async (id: string, managerId: string | null) => {
    try {
      await setManager.mutateAsync({ id, managerId })
    } catch (err) {
      toastError(err, 'Could not re-parent')
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <header className="app-region-drag flex shrink-0 items-center gap-3 border-border/50 border-b px-6 py-3">
        <span className="inline-flex size-9 items-center justify-center rounded-full bg-[color:var(--accent-orange)]/10 text-[color:var(--accent-orange)]">
          <Network className="size-4" />
        </span>
        <div>
          <p className="font-semibold text-[16px] leading-tight">Org chart</p>
          <p className="text-[12px] text-muted-foreground leading-snug">
            Who reports to whom — agents use this to delegate
          </p>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-auto">
        <div className="flex min-w-max justify-center px-10 py-10">
          {list.length === 0 ? (
            <div className="flex flex-col items-center gap-3">
              <FounderCard reports={0} />
              <p className="max-w-sm rounded-2xl border border-border/60 border-dashed bg-card/30 px-6 py-8 text-center text-[13px] text-muted-foreground">
                No employees yet. Hire someone from the rail to start your org.
              </p>
            </div>
          ) : (
            <TreeNode
              card={<FounderCard reports={directReports.length} />}
              kids={directReports.map((emp) => (
                <Subtree
                  key={emp.id}
                  employee={emp}
                  byManager={byManager}
                  employees={list}
                  onSetManager={onSetManager}
                />
              ))}
            />
          )}
        </div>
      </div>
    </div>
  )
}

interface TreeNodeProps {
  card: React.ReactNode
  kids: React.ReactNode[]
}

const TreeNode: FC<TreeNodeProps> = ({ card, kids }) => {
  const count = kids.length
  return (
    <div className="flex flex-col items-center">
      {card}
      {count > 0 ? (
        <>
          <div className="h-6 w-px bg-border" />
          <div className="flex">
            {kids.map((child, i) => (
              <TreeChild
                // biome-ignore lint/suspicious/noArrayIndexKey: stable child order from caller
                key={i}
                index={i}
                count={count}
              >
                {child}
              </TreeChild>
            ))}
          </div>
        </>
      ) : null}
    </div>
  )
}

const TreeChild: FC<{
  index: number
  count: number
  children: React.ReactNode
}> = ({ index, count, children }) => {
  const connectorClass = horizontalConnectorClass(index, count)
  return (
    <div className="relative flex flex-col items-center px-4">
      {count > 1 ? (
        <div className={cn('absolute top-0 h-px bg-border', connectorClass)} />
      ) : null}
      <div className="h-6 w-px bg-border" />
      {children}
    </div>
  )
}

function horizontalConnectorClass(index: number, count: number): string {
  if (index === 0) return 'right-0 left-1/2'
  if (index === count - 1) return 'right-1/2 left-0'
  return 'right-0 left-0'
}

interface SubtreeProps {
  employee: Employee
  byManager: Map<string | null, Employee[]>
  employees: Employee[]
  onSetManager: (id: string, managerId: string | null) => void
}

const Subtree: FC<SubtreeProps> = ({
  employee,
  byManager,
  employees,
  onSetManager,
}) => {
  const reports = byManager.get(employee.id) ?? []
  return (
    <TreeNode
      card={
        <NodeCard
          employee={employee}
          directReports={reports.length}
          employees={employees}
          onSetManager={onSetManager}
        />
      }
      kids={reports.map((r) => (
        <Subtree
          key={r.id}
          employee={r}
          byManager={byManager}
          employees={employees}
          onSetManager={onSetManager}
        />
      ))}
    />
  )
}

const FounderCard: FC<{ reports: number }> = ({ reports }) => (
  <div className="flex w-[240px] flex-col items-center gap-2 rounded-2xl border border-[color:var(--accent-orange)]/30 bg-gradient-to-br from-[color:var(--accent-orange)]/[0.08] to-transparent p-4 text-center shadow-sm">
    <span className="inline-flex size-12 items-center justify-center rounded-full bg-[color:var(--accent-orange)]/15 text-[color:var(--accent-orange)]">
      <Crown className="size-5" />
    </span>
    <div>
      <p className="font-semibold text-[14px] text-foreground leading-tight">
        You
      </p>
      <p className="mt-0.5 text-[11.5px] text-muted-foreground">
        Founder · Owner
      </p>
    </div>
    {reports > 0 ? (
      <span className="inline-flex items-center gap-1 rounded-full bg-muted/60 px-2 py-0.5 font-mono text-[10px] text-muted-foreground/80 uppercase tracking-[0.14em]">
        <Users2 className="size-3" />
        {reports} direct report{reports === 1 ? '' : 's'}
      </span>
    ) : null}
  </div>
)

const NodeCard: FC<{
  employee: Employee
  directReports: number
  employees: Employee[]
  onSetManager: (id: string, managerId: string | null) => void
}> = ({ employee, directReports, employees, onSetManager }) => {
  const descendants = collectDescendants(employees, employee.id)
  const validManagers = employees.filter(
    (e) => e.id !== employee.id && !descendants.has(e.id),
  )

  return (
    <div className="flex w-[240px] flex-col gap-2 rounded-2xl border border-border/60 bg-card/80 p-3 shadow-sm transition-colors hover:border-border hover:bg-card">
      <div className="flex items-center gap-3">
        <Avatar
          monogram={employee.monogram}
          tint={employee.tint as Tint}
          size="md"
        />
        <Link
          to="/e/$employeeId/t/$threadId"
          params={{ employeeId: employee.id, threadId: 'general' }}
          className="min-w-0 flex-1"
          title={`Open chat with ${employee.name}`}
        >
          <p className="truncate font-semibold text-[13.5px] text-foreground leading-tight">
            {employee.name}
          </p>
          <p className="truncate text-[11.5px] text-muted-foreground">
            {employee.role}
          </p>
        </Link>
        <Link
          to="/e/$employeeId/t/$threadId"
          params={{ employeeId: employee.id, threadId: 'general' }}
          className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-accent hover:text-foreground"
          title="DM"
        >
          <MessageSquare className="size-3" />
        </Link>
      </div>
      <div className="flex items-center justify-between gap-2 border-border/40 border-t pt-2">
        {directReports > 0 ? (
          <span className="inline-flex items-center gap-1 font-mono text-[10px] text-muted-foreground uppercase tracking-[0.14em]">
            <Users2 className="size-3" />
            {directReports} report{directReports === 1 ? '' : 's'}
          </span>
        ) : (
          <span className="font-mono text-[10px] text-muted-foreground/50 uppercase tracking-[0.14em]">
            No reports
          </span>
        )}
        <select
          value={employee.managerId ?? 'user'}
          onChange={(e) => {
            const v = e.target.value
            onSetManager(employee.id, v === 'user' ? null : v)
          }}
          className="rounded-md border border-border/50 bg-card px-1.5 py-0.5 text-[11px] text-muted-foreground outline-none transition-colors hover:bg-accent focus:border-[color:var(--accent-orange)]/40"
          title="Reports to"
        >
          <option value="user">↑ You</option>
          {validManagers.map((m) => (
            <option key={m.id} value={m.id}>
              ↑ {m.name}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}

function collectDescendants(
  employees: Employee[],
  rootId: string,
): Set<string> {
  const result = new Set<string>([rootId])
  const queue = [rootId]
  while (queue.length > 0) {
    const id = queue.shift()
    if (!id) break
    for (const e of employees) {
      if (e.managerId === id && !result.has(e.id)) {
        result.add(e.id)
        queue.push(e.id)
      }
    }
  }
  return result
}
