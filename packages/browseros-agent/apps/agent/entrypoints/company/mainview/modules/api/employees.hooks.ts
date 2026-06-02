import type { InferRequestType, InferResponseType } from 'hono/client'
import { createMutation, createQuery } from 'react-query-kit'
import { api } from './client'
import { parseResponse } from './parseResponse'
import { queryClient } from './queryClient'

const $list = api.employees.$get
const $listWithRecent = api.employees['with-recent-threads'].$get
const $detail = api.employees[':id'].$get
const $hire = api.employees.$post
const $fire = api.employees[':id'].$delete
const $setManager = api.employees[':id'].manager.$patch

export type EmployeesResponse = InferResponseType<typeof $list>
export type Employee = EmployeesResponse[number]

export type EmployeesWithRecentResponse = InferResponseType<
  typeof $listWithRecent
>
export type EmployeeWithRecent = EmployeesWithRecentResponse[number]
// The recent-threads slice carries rail-specific fields (railStatus,
// unread, pending) that the per-employee /threads endpoint doesn't
// surface. Export it as its own type so the rail's per-thread row can
// type the augmented shape without losing those fields.
export type RecentThread = EmployeeWithRecent['recentThreads'][number]

type HireInput = InferRequestType<typeof $hire>['json']
type HireResponse = InferResponseType<typeof $hire>
type FireOk = Exclude<InferResponseType<typeof $fire>, { error: string }>
type SetManagerInput = {
  id: string
  managerId: string | null
}
type SetManagerResponse = Exclude<
  InferResponseType<typeof $setManager>,
  { error: string }
>

export const useEmployees = createQuery<EmployeesResponse>({
  queryKey: ['employees'],
  fetcher: () => $list().then(parseResponse<EmployeesResponse>),
})

export const useEmployeesWithRecentThreads = createQuery<
  EmployeesWithRecentResponse,
  { limit?: number }
>({
  queryKey: ['employees', 'with-recent-threads'],
  fetcher: ({ limit }) =>
    $listWithRecent({
      query: limit ? { limit: String(limit) } : {},
    }).then(parseResponse<EmployeesWithRecentResponse>),
})

export const useEmployee = createQuery<Employee, { id: string }>({
  queryKey: ['employees', 'detail'],
  fetcher: ({ id }) => $detail({ param: { id } }).then(parseResponse<Employee>),
})

export const useHireEmployee = createMutation<HireResponse, HireInput>({
  mutationFn: (json) => $hire({ json }).then(parseResponse<HireResponse>),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: useEmployees.getKey() })
    queryClient.invalidateQueries({
      queryKey: useEmployeesWithRecentThreads.getKey(),
    })
  },
})

export const useFireEmployee = createMutation<FireOk, { id: string }>({
  mutationFn: ({ id }) => $fire({ param: { id } }).then(parseResponse<FireOk>),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: useEmployees.getKey() })
    queryClient.invalidateQueries({
      queryKey: useEmployeesWithRecentThreads.getKey(),
    })
  },
})

export const useSetEmployeeManager = createMutation<
  SetManagerResponse,
  SetManagerInput
>({
  mutationFn: ({ id, managerId }) =>
    $setManager({ param: { id }, json: { managerId } }).then(
      parseResponse<SetManagerResponse>,
    ),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: useEmployees.getKey() })
    queryClient.invalidateQueries({
      queryKey: useEmployeesWithRecentThreads.getKey(),
    })
  },
})
