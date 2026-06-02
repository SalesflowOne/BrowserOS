import type { InferRequestType, InferResponseType } from 'hono/client'
import { createMutation, createQuery } from 'react-query-kit'
import type { BrowserTabAttachment } from '../../../shared/attachments'
import type { PermissionMode } from '../../../shared/permission'
import { api } from './client'
import { useEmployeesWithRecentThreads } from './employees.hooks'
import { parseResponse } from './parseResponse'
import { queryClient } from './queryClient'

const $employeeThreads = api.employees[':employeeId'].threads.$get
const $thread = api.threads[':id'].$get
const $create = api.employees[':employeeId'].threads.$post
const $rename = api.threads[':id'].$patch
const $messages = api.threads[':id'].messages.$get
const $send = api.threads[':id'].messages.$post
const $interrupt = api.threads[':id'].interrupt.$post
const $seen = api.threads[':id'].seen.$post

type SeenResponse = Exclude<InferResponseType<typeof $seen>, { error: string }>

export type ThreadRow = InferResponseType<typeof $employeeThreads>[number]
type ThreadMessageRow = InferResponseType<typeof $messages>[number]

type CreateInput = InferRequestType<typeof $create>['json']
type CreateResponse = Exclude<
  InferResponseType<typeof $create>,
  { error: string }
>
type SendResponse = Exclude<InferResponseType<typeof $send>, { error: string }>

export const useEmployeeThreads = createQuery<
  ThreadRow[],
  { employeeId: string }
>({
  queryKey: ['threads', 'employee'],
  fetcher: ({ employeeId }) =>
    $employeeThreads({ param: { employeeId } }).then(
      parseResponse<ThreadRow[]>,
    ),
})

export const useThread = createQuery<ThreadRow, { id: string }>({
  queryKey: ['threads', 'detail'],
  fetcher: ({ id }) =>
    $thread({ param: { id } }).then(parseResponse<ThreadRow>),
})

export const useThreadMessages = createQuery<
  ThreadMessageRow[],
  { id: string }
>({
  queryKey: ['threads', 'messages'],
  fetcher: ({ id }) =>
    $messages({ param: { id } }).then(parseResponse<ThreadMessageRow[]>),
})

export const useCreateThread = createMutation<
  CreateResponse,
  { employeeId: string } & CreateInput
>({
  mutationFn: ({ employeeId, ...rest }) =>
    $create({ param: { employeeId }, json: rest }).then(
      parseResponse<CreateResponse>,
    ),
  onSuccess: (_data, vars) => {
    queryClient.invalidateQueries({
      queryKey: useEmployeeThreads.getKey({ employeeId: vars.employeeId }),
    })
    queryClient.invalidateQueries({
      queryKey: useEmployeesWithRecentThreads.getKey(),
    })
  },
})

type PatchResponse = Exclude<
  InferResponseType<typeof $rename>,
  { error: string }
>

interface UpdateThreadOverridesVars {
  id: string
  agentKindOverride?: string | null
  modelIdOverride?: string | null
  reasoningEffortOverride?: string | null
  workspacePathOverride?: string | null
  permissionMode?: PermissionMode
}

// Persists picker selections to the thread row. The composer's
// pickers read override columns directly off the cached thread
// row, so onMutate writes the new value into the detail cache
// synchronously. That makes the picker reflect the pick on the
// next render and means a navigate-away-and-back can't land on a
// pre-PATCH snapshot. The background PATCH is just persistence;
// onSuccess only has to refresh the rail's per-employee list.
export const useUpdateThreadOverrides = createMutation<
  PatchResponse,
  UpdateThreadOverridesVars
>({
  mutationFn: ({ id, ...overrides }) =>
    $rename({ param: { id }, json: overrides }).then(
      parseResponse<PatchResponse>,
    ),
  onMutate: (vars) => {
    queryClient.setQueryData<ThreadRow>(
      useThread.getKey({ id: vars.id }),
      (old) => {
        if (!old) return old
        const next: ThreadRow = { ...old }
        if (vars.agentKindOverride !== undefined) {
          next.agentKindOverride = vars.agentKindOverride
        }
        if (vars.modelIdOverride !== undefined) {
          next.modelIdOverride = vars.modelIdOverride
        }
        if (vars.reasoningEffortOverride !== undefined) {
          next.reasoningEffortOverride = vars.reasoningEffortOverride
        }
        if (vars.workspacePathOverride !== undefined) {
          next.workspacePathOverride = vars.workspacePathOverride
        }
        if (vars.permissionMode !== undefined) {
          next.permissionMode = vars.permissionMode
        }
        return next
      },
    )
  },
  onSuccess: (data) => {
    queryClient.invalidateQueries({
      queryKey: useEmployeeThreads.getKey({ employeeId: data.employeeId }),
    })
  },
})

// User-initiated rename from the rail's right-click menu. Idempotent on
// the server (same PATCH endpoint as overrides). Invalidates both the
// per-employee threads list and the bulk recent-threads read so the new
// title shows everywhere it appears.
export const useRenameThread = createMutation<
  PatchResponse,
  { id: string; title: string }
>({
  mutationFn: ({ id, title }) =>
    $rename({ param: { id }, json: { title } }).then(
      parseResponse<PatchResponse>,
    ),
  onSuccess: (data) => {
    queryClient.invalidateQueries({
      queryKey: useEmployeeThreads.getKey({ employeeId: data.employeeId }),
    })
    queryClient.invalidateQueries({
      queryKey: useEmployeesWithRecentThreads.getKey(),
    })
    queryClient.invalidateQueries({
      queryKey: useThread.getKey({ id: data.id }),
    })
  },
})

// Bumps threads.lastSeenAt = now. Fired from the chat surface's mount
// effect when the user opens a thread; the rail's "attention" indicator
// clears on the next refetch. Idempotent — the server's rail-status
// derivation compares with strict `>`, so two rapid PATCHes are
// harmless.
export const useSeenThread = createMutation<SeenResponse, { id: string }>({
  mutationFn: ({ id }) =>
    $seen({ param: { id } }).then(parseResponse<SeenResponse>),
  onSuccess: () => {
    queryClient.invalidateQueries({
      queryKey: useEmployeesWithRecentThreads.getKey(),
    })
  },
})

// Soft-archive — flips `archivedAt`. The rail's GET filter drops
// archived rows so the row disappears as soon as the invalidation
// re-fetches. There's no archive screen yet; restoring requires a
// direct PATCH (no UI button for now).
export const useArchiveThread = createMutation<PatchResponse, { id: string }>({
  mutationFn: ({ id }) =>
    $rename({ param: { id }, json: { archivedAt: Date.now() } }).then(
      parseResponse<PatchResponse>,
    ),
  onSuccess: (data) => {
    queryClient.invalidateQueries({
      queryKey: useEmployeeThreads.getKey({ employeeId: data.employeeId }),
    })
    queryClient.invalidateQueries({
      queryKey: useEmployeesWithRecentThreads.getKey(),
    })
  },
})

interface SendThreadMessageVars {
  id: string
  text: string
  agentKindOverride?: string | null
  modelIdOverride?: string | null
  reasoningEffortOverride?: string | null
  workspacePathOverride?: string | null
  attachments?: BrowserTabAttachment[]
}

type InterruptResponse = Exclude<
  InferResponseType<typeof $interrupt>,
  { error: string }
>

// Cancels the in-flight turn on a thread. The server resolves the
// session's interrupt and emits `turn.cancel`; the SSE consumer
// reduces that into status='cancelled' and clears the live turn, so
// the UI doesn't need to do any optimistic state — just fire and
// trust the event stream.
export const useInterruptThread = createMutation<
  InterruptResponse,
  { id: string }
>({
  mutationFn: ({ id }) =>
    $interrupt({ param: { id } }).then(parseResponse<InterruptResponse>),
})

export const useSendThreadMessage = createMutation<
  SendResponse,
  SendThreadMessageVars
>({
  mutationFn: ({ id, text, attachments, ...overrides }) =>
    $send({ param: { id }, json: { text, attachments, ...overrides } }).then(
      parseResponse<SendResponse>,
    ),
  // The user bubble appears as soon as the server emits `turn.start`,
  // so no optimistic cache write is needed — the SSE stream is the
  // canonical surface for chat content. Refresh the rail's recency
  // ordering after the turn finishes, plus the per-thread row so the
  // composer's persisted tuple stays in sync (the messages route
  // writes override columns before sending).
  onSuccess: (_data, vars) => {
    queryClient.invalidateQueries({
      queryKey: useEmployeesWithRecentThreads.getKey(),
    })
    queryClient.invalidateQueries({
      queryKey: useThread.getKey({ id: vars.id }),
    })
  },
})
