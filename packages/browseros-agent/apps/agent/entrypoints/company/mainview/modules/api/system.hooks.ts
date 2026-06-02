import type { InferRequestType, InferResponseType } from 'hono/client'
import { nanoid } from 'nanoid'
import { useCallback } from 'react'
import { createMutation, createQuery } from 'react-query-kit'
import { api } from './client'
import { parseResponse } from './parseResponse'
import { queryClient } from './queryClient'

const $settings = api.system.settings.$get
const $updateSettings = api.system.settings.$patch
const $checkBrowseros = api.system.browseros.check.$post
const $browserosStatus = api.system.browseros.status.$get

export type SystemSettings = InferResponseType<typeof $settings>
type BrowserosMcpCheck = Exclude<
  InferResponseType<typeof $checkBrowseros>,
  { error: string }
>
type UpdateSettingsResponse = Exclude<
  InferResponseType<typeof $updateSettings>,
  { error: string }
>
type UpdateSettingsInput = InferRequestType<typeof $updateSettings>['json']
type CheckBrowserosInput = InferRequestType<typeof $checkBrowseros>['json']

export type McpServer = SystemSettings['mcpServers'][number]
// Distribute Omit over the discriminated union so each branch keeps its
// transport-specific fields (command/args vs url/headers). A bare
// `Omit<McpServer, 'id'>` collapses the union and TS only sees the common
// keys, which trips object-literal checks at the form submit site.
export type McpServerDraft = McpServer extends infer T
  ? T extends McpServer
    ? Omit<T, 'id'>
    : never
  : never

export const useSystemSettings = createQuery<SystemSettings>({
  queryKey: ['system', 'settings'],
  fetcher: () => $settings().then(parseResponse<SystemSettings>),
})

export const useUpdateSystemSettings = createMutation<
  UpdateSettingsResponse,
  UpdateSettingsInput
>({
  mutationFn: (json) =>
    $updateSettings({ json }).then(parseResponse<UpdateSettingsResponse>),
  onSuccess: (data) => {
    queryClient.setQueryData(useSystemSettings.getKey(), data)
  },
})

export const useCheckBrowserosMcp = createMutation<
  BrowserosMcpCheck,
  CheckBrowserosInput
>({
  mutationFn: (json) =>
    $checkBrowseros({ json }).then(parseResponse<BrowserosMcpCheck>),
})

/**
 * MCP server CRUD on top of useSystemSettings + useUpdateSystemSettings.
 * Each mutation reads the current array, applies the change, and PATCHes
 * the whole list back — the API treats the registry as a single document
 * rather than per-row operations.
 */
export function useMcpRegistry(): {
  servers: McpServer[]
  isLoading: boolean
  isUpdating: boolean
  add: (draft: McpServerDraft) => Promise<UpdateSettingsResponse>
  update: (id: string, draft: McpServerDraft) => Promise<UpdateSettingsResponse>
  remove: (id: string) => Promise<UpdateSettingsResponse>
} {
  const { data, isLoading } = useSystemSettings()
  const { mutateAsync, isPending } = useUpdateSystemSettings()
  const servers = data?.mcpServers ?? []

  const add = useCallback(
    (draft: McpServerDraft) => {
      const next = [...servers, { ...draft, id: nanoid(8) } as McpServer]
      return mutateAsync({ mcpServers: next })
    },
    [mutateAsync, servers],
  )

  const update = useCallback(
    (id: string, draft: McpServerDraft) => {
      const next = servers.map((server) =>
        server.id === id ? ({ ...draft, id } as McpServer) : server,
      )
      return mutateAsync({ mcpServers: next })
    },
    [mutateAsync, servers],
  )

  const remove = useCallback(
    (id: string) => {
      const next = servers.filter((server) => server.id !== id)
      return mutateAsync({ mcpServers: next })
    },
    [mutateAsync, servers],
  )

  return { servers, isLoading, isUpdating: isPending, add, update, remove }
}

// Polls the saved BrowserOS endpoint so the global status banner can react
// when BrowserOS goes down or comes back up. M1 done-bar requires this to
// clear within 30s of BrowserOS launching, so a 15s interval keeps us
// comfortably inside that window. `staleTime` sits just under the interval
// so an alt-tab back to the window doesn't double-fire right after a
// scheduled poll.
export const useBrowserosStatus = createQuery<BrowserosMcpCheck>({
  queryKey: ['system', 'browseros', 'status'],
  fetcher: () => $browserosStatus().then(parseResponse<BrowserosMcpCheck>),
  refetchInterval: 15_000,
  staleTime: 14_000,
})
