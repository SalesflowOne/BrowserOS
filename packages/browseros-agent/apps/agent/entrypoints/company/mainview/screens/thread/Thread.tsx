import { ChatSurface } from '@company/components/layout/ChatSurface'
import { useEmployee } from '@company/modules/api/employees.hooks'
import {
  useEmployeeThreads,
  useThread,
} from '@company/modules/api/threads.hooks'
import { useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'

interface Props {
  employeeId: string
  threadId: string
}

export function ThreadScreen({ employeeId, threadId }: Props) {
  const navigate = useNavigate()
  const employee = useEmployee({ variables: { id: employeeId } })
  const threads = useEmployeeThreads({
    variables: { employeeId },
    enabled: threadId === 'general',
  })
  const thread = useThread({
    variables: { id: threadId },
    enabled: threadId !== 'general',
  })

  // When the rail links to the synthetic 'general' threadId, redirect to
  // the employee's actual general thread (or first thread if none flagged).
  // For employees with no threads at all, route to the new-thread screen
  // instead of stalling on "Loading…" forever.
  useEffect(() => {
    if (threadId !== 'general' || !threads.data) return
    const general = threads.data.find((t) => t.isGeneral) ?? threads.data[0]
    if (general) {
      void navigate({
        to: '/e/$employeeId/t/$threadId',
        params: { employeeId, threadId: general.id },
        replace: true,
      })
      return
    }
    void navigate({
      to: '/e/$employeeId/new',
      params: { employeeId },
      replace: true,
    })
  }, [threadId, threads.data, employeeId, navigate])

  if (!employee.data) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground text-sm">
        {employee.isLoading ? 'Loading…' : 'Employee not found.'}
      </div>
    )
  }

  if (threadId === 'general') {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground text-sm">
        Loading…
      </div>
    )
  }

  if (!thread.data) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground text-sm">
        {thread.isLoading ? 'Loading…' : 'Thread not found.'}
      </div>
    )
  }

  // `key={thread.id}` is load-bearing. Without it, navigating between
  // cached threads reuses this ChatSurface instance and its internal
  // state survives the route param change: Composer's `draft` text and
  // `pickerIndex`, the composer tuple, any future per-thread picker
  // state (e.g. permission mode override) all leak across threads.
  //
  // The path /e/$employeeId/t/$threadId stays mounted across :threadId
  // changes, so React reconciles ChatSurface as the same instance.
  // The "Loading…" / "Thread not found." branches above only unmount
  // on a TanStack Query cache miss; navigating between two cached
  // threads goes straight from one ChatSurface render to the next
  // without an unmount.
  //
  // Sync-effect resets (`useEffect(...,[thread.id])`) reset only the
  // specific state they target and run AFTER the first render with
  // the new prop, so there's always a frame of stale composer state
  // visible. Forcing a remount via key is the simplest correct fix.
  // Do not remove this key without replacing it with an equally hard
  // remount guarantee.
  return (
    <ChatSurface
      key={thread.data.id}
      employee={employee.data}
      thread={thread.data}
    />
  )
}
