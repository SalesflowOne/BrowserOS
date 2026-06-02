import type { ComposerTuple } from '@company/components/chat/Composer'
import { AGENT_CAPABILITIES, isAgentKind } from '@company/lib/capabilities'
import { requestFocus } from '@company/lib/composerFocusSignal'
import {
  type EmployeeWithRecent,
  useEmployeesWithRecentThreads,
} from '@company/modules/api/employees.hooks'
import { toastError } from '@company/modules/api/errorToast'
import { queryClient } from '@company/modules/api/queryClient'
import {
  useCreateThread,
  useSendThreadMessage,
  useThread,
} from '@company/modules/api/threads.hooks'
import { useNavigate } from '@tanstack/react-router'
import { useCallback, useMemo } from 'react'

// Sort employees by most-recent thread activity, then hire order as
// the tie-breaker. Extracted as a pure helper so the picker hook's
// only React-specific job is calling the query. Mirrors Rail's sort
// at Rail.tsx:120-132 so both surfaces show the same ordering.
export function sortEmployeesByRecency(
  rows: readonly EmployeeWithRecent[],
): EmployeeWithRecent[] {
  const list = [...rows]
  list.sort((a, b) => {
    const aT = a.lastActivityAt ?? 0
    const bT = b.lastActivityAt ?? 0
    if (aT !== bT) return bT - aT
    return a.hiredAt - b.hiredAt
  })
  return list
}

// Must match the rail's call signature (`variables: { limit }`) so the
// dialog and the rail share one cache entry. react-query-kit derives
// the cache key from `variables`; calling this hook with no `variables`
// returns a different key, which on a fresh dialog open looks like an
// empty result and trips the "no employees hired" branch even when the
// rail has every employee loaded.
const DIALOG_RECENT_LIMIT = 5

export function useEmployeesForPicker(): {
  employees: EmployeeWithRecent[]
  isReady: boolean
} {
  const q = useEmployeesWithRecentThreads({
    variables: { limit: DIALOG_RECENT_LIMIT },
  })
  const sorted = useMemo(() => sortEmployeesByRecency(q.data ?? []), [q.data])
  // `isReady` is true only once the fetch has actually resolved. Used
  // by the dialog to gate the empty-state CTA so it never flashes
  // during the initial load.
  return { employees: sorted, isReady: q.isSuccess }
}

interface SendNewChatInput {
  employeeId: string
  text: string
  tuple: ComposerTuple
}

// Encapsulates the create-then-send-then-navigate dance from
// NewThread.handleSubmit so the dialog only owns one async call.
export function useSendNewChat() {
  const navigate = useNavigate()
  const createThread = useCreateThread()
  const send = useSendThreadMessage()
  const createMutateAsync = createThread.mutateAsync
  const sendMutateAsync = send.mutateAsync

  const submit = useCallback(
    async ({ employeeId, text, tuple }: SendNewChatInput) => {
      let thread: Awaited<ReturnType<typeof createMutateAsync>>
      try {
        thread = await createMutateAsync({ employeeId })
      } catch (err) {
        toastError(err, 'Could not start the thread')
        throw err
      }

      // Same cache priming as NewThread so ChatSurface mounts without
      // a second round trip; rail refreshes so the new thread appears.
      queryClient.setQueryData(useThread.getKey({ id: thread.id }), thread)
      queryClient.invalidateQueries({
        queryKey: useEmployeesWithRecentThreads.getKey(),
      })

      void sendMutateAsync({
        id: thread.id,
        text,
        agentKindOverride: tuple.agentKind,
        modelIdOverride: tuple.modelId,
        reasoningEffortOverride: tuple.reasoningEffort,
        workspacePathOverride: tuple.workspacePath,
      }).catch((err) => toastError(err, 'Send failed'))

      // Raise the focus signal before navigate(). The destination
      // ChatSurface consumes it on mount and focuses its own Composer.
      requestFocus()
      void navigate({
        to: '/e/$employeeId/t/$threadId',
        params: { employeeId, threadId: thread.id },
      })
    },
    [createMutateAsync, navigate, sendMutateAsync],
  )

  return {
    submit,
    isPending: createThread.isPending || send.isPending,
  }
}

// Pure picker; exposed for tests + for the dialog's defaulting logic.
export function initialTupleForEmployee(
  employee: EmployeeWithRecent,
): ComposerTuple {
  const effectiveAgent = isAgentKind(employee.agentKind)
    ? employee.agentKind
    : 'claude'
  const caps = AGENT_CAPABILITIES[effectiveAgent]
  return {
    agentKind: effectiveAgent,
    modelId: employee.modelId ?? caps.defaultModelId,
    reasoningEffort: employee.reasoningEffort ?? caps.defaultEffort,
    workspacePath: employee.workspacePath ?? null,
  }
}
