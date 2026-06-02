import type { InferRequestType, InferResponseType } from 'hono/client'
import { createMutation, createQuery } from 'react-query-kit'
import { api } from './client'
import { parseResponse } from './parseResponse'
import { queryClient } from './queryClient'

const $list = api.telegram.connections.$get
const $create = api.employees[':employeeId'].telegram.connection.$post
const $remove = api.telegram.connections[':id'].$delete
const $restart = api.telegram.connections[':id'].restart.$post

export type TelegramConnectionsResponse = InferResponseType<typeof $list>
export type TelegramConnection = TelegramConnectionsResponse[number]

type CreateInput = {
  employeeId: string
  body: InferRequestType<typeof $create>['json']
}
type CreateResponse = Exclude<
  InferResponseType<typeof $create>,
  { error: string }
>
type RemoveOk = Exclude<InferResponseType<typeof $remove>, { error: string }>
type RestartResponse = Exclude<
  InferResponseType<typeof $restart>,
  { error: string }
>

export const useTelegramConnections = createQuery<TelegramConnectionsResponse>({
  queryKey: ['telegram', 'connections'],
  fetcher: () => $list().then(parseResponse<TelegramConnectionsResponse>),
  // Poll: bot startup status changes asynchronously after a POST returns,
  // and stale `lastError` rows should self-heal on the next refresh
  // without the user having to reload the window.
  refetchInterval: 5_000,
})

export const useCreateTelegramConnection = createMutation<
  CreateResponse,
  CreateInput
>({
  mutationFn: ({ employeeId, body }) =>
    $create({ param: { employeeId }, json: body }).then(
      parseResponse<CreateResponse>,
    ),
  onSuccess: () => {
    queryClient.invalidateQueries({
      queryKey: useTelegramConnections.getKey(),
    })
  },
})

export const useDeleteTelegramConnection = createMutation<
  RemoveOk,
  { id: string }
>({
  mutationFn: ({ id }) =>
    $remove({ param: { id } }).then(parseResponse<RemoveOk>),
  onSuccess: () => {
    queryClient.invalidateQueries({
      queryKey: useTelegramConnections.getKey(),
    })
  },
})

export const useRestartTelegramConnection = createMutation<
  RestartResponse,
  { id: string }
>({
  mutationFn: ({ id }) =>
    $restart({ param: { id } }).then(parseResponse<RestartResponse>),
  onSuccess: () => {
    queryClient.invalidateQueries({
      queryKey: useTelegramConnections.getKey(),
    })
  },
})
