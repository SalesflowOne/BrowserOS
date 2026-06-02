import type { InferResponseType } from 'hono/client'
import { useCallback } from 'react'
import { createMutation, createQuery } from 'react-query-kit'
import { api } from './client'
import { parseResponse } from './parseResponse'
import { queryClient } from './queryClient'
import { useThreadMessages } from './threads.hooks'

const $list = api.approvals.$get
const $pending = api.approvals.pending.$get
const $resolve = api.approvals[':id'].resolve.$post

export type ApprovalRow = InferResponseType<typeof $list>[number]

// Module-internal — the only consumer is `useApprovalById` below.
// External callers should subscribe per-row via `useApprovalById` so
// they participate in TanStack Query's structural sharing instead of
// receiving the whole list and busting their own memos.
const useApprovals = createQuery<ApprovalRow[]>({
  queryKey: ['approvals'],
  fetcher: () => $list().then(parseResponse<ApprovalRow[]>),
})

/**
 * Per-row approval lookup. Backed by the same query as `useApprovals`
 * but uses react-query's `select` to subscribe only to one approval —
 * TanStack does structural sharing on the selected output, so when a
 * different approval changes the subscribing row does not re-render.
 * This is what lets ChatMessageRow stay memoized while approvals
 * refetch from the server.
 */
export function useApprovalById(
  approvalId: string | undefined,
): ApprovalRow | undefined {
  // Stabilize the select fn by useCallback so TanStack Query reuses
  // the cached selected output across renders. Without this, every
  // parent re-render (every text.delta on the live row) gives a fresh
  // arrow function, TanStack re-runs the .find scan over the
  // approvals list, and the row pays the O(n) cost per frame.
  const select = useCallback(
    (rows: ApprovalRow[]) =>
      approvalId ? rows.find((a) => a.id === approvalId) : undefined,
    [approvalId],
  )
  const { data } = useApprovals({ select })
  return data
}

export const usePendingApprovals = createQuery<ApprovalRow[]>({
  queryKey: ['approvals', 'pending'],
  fetcher: () => $pending().then(parseResponse<ApprovalRow[]>),
})

type ResolveResponse = Exclude<
  InferResponseType<typeof $resolve>,
  { error: string }
>

export const useResolveApproval = createMutation<
  ResolveResponse,
  { id: string; status: 'approved' | 'rejected' }
>({
  mutationFn: ({ id, status }) =>
    $resolve({ param: { id }, json: { status } }).then(
      parseResponse<ResolveResponse>,
    ),
  onSuccess: (data) => {
    queryClient.invalidateQueries({ queryKey: useApprovals.getKey() })
    queryClient.invalidateQueries({ queryKey: usePendingApprovals.getKey() })
    queryClient.invalidateQueries({
      queryKey: useThreadMessages.getKey({ id: data.surfaceId }),
    })
  },
})
