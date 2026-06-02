import { createMutation } from 'react-query-kit'
import type { PermissionDecision } from '../../../shared/permission'
import { api } from './client'
import { parseResponse } from './parseResponse'

const $resolve = api.threads[':id'].permission[':requestId'].$post

interface ResolvePermissionVars {
  threadId: string
  requestId: string
  outcome: PermissionDecision
}

// POSTs the user's decision to the permission registry. The matching
// permission.resolved event lands on the SSE stream from the
// callback's finalize path; no invalidation needed here — the
// reducer transitions the card in place when that event arrives.
//
// onError → toast at the call site (PermissionApprovalCard); we
// don't centralise it here so the card can clear its submitting
// guard on failure.
export const useResolvePermission = createMutation<
  { ok: true } | { error: string },
  ResolvePermissionVars
>({
  mutationFn: ({ threadId, requestId, outcome }) =>
    $resolve({
      param: { id: threadId, requestId },
      json: { outcome },
    }).then(parseResponse<{ ok: true } | { error: string }>),
})
