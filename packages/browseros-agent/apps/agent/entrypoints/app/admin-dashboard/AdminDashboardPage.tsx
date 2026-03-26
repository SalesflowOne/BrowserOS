import { type FC, useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { pendingToolApprovalsStorage } from '@/lib/tool-approvals/approval-sync-storage'
import { ExecutionLog } from './ExecutionLog'
import { PendingApprovals } from './PendingApprovals'

export const AdminDashboardPage: FC = () => {
  const [pendingCount, setPendingCount] = useState(0)

  useEffect(() => {
    pendingToolApprovalsStorage
      .getValue()
      .then((v) => setPendingCount(v.length))
    const unwatch = pendingToolApprovalsStorage.watch((v) =>
      setPendingCount(v.length),
    )
    return () => unwatch()
  }, [])

  return (
    <div className="space-y-8">
      <div>
        <h2 className="font-semibold text-xl tracking-tight">
          Admin Dashboard
        </h2>
        <p className="text-muted-foreground text-sm">
          Monitor agent activity and manage tool approval requests.
        </p>
      </div>

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <h3 className="font-medium text-base">Pending Approvals</h3>
          {pendingCount > 0 && (
            <Badge className="bg-yellow-500/10 text-xs text-yellow-600 hover:bg-yellow-500/10">
              {pendingCount}
            </Badge>
          )}
        </div>
        <PendingApprovals />
      </section>

      <section className="space-y-3">
        <h3 className="font-medium text-base">Execution Log</h3>
        <ExecutionLog />
      </section>
    </div>
  )
}
