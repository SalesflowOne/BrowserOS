import { createMutation, createQuery } from 'react-query-kit'
import { api } from './client'
import { parseResponse } from './parseResponse'
import { queryClient } from './queryClient'

const $tabs = api.browseros.tabs.$get
const $appWindow = api.browseros['app-window'].$get
const $appWindowVisibility = api.browseros['app-window'].visibility.$patch

interface AppWindowState {
  windowId: number | null
  visibility: 'visible' | 'hidden'
  degraded: boolean
  message?: string
}

export const useAppWindow = createQuery<AppWindowState>({
  queryKey: ['browseros', 'app-window'],
  fetcher: () => $appWindow().then(parseResponse<AppWindowState>),
  staleTime: 5_000,
})

interface ToggleResult {
  newWindowId: number
  previousWindowId: number
  replaced: boolean
  visibility: 'visible' | 'hidden'
}

// The server refuses with 409 if any agent is mid-turn and disposes
// all cached MCP sessions on success so the next send rebuilds.
export const useToggleAppWindowVisibility = createMutation<
  ToggleResult,
  { visibility: 'visible' | 'hidden' }
>({
  mutationFn: ({ visibility }) =>
    $appWindowVisibility({ json: { visibility } }).then(
      parseResponse<ToggleResult>,
    ),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: useAppWindow.getKey() })
  },
})

export interface BrowserTab {
  pageId: number
  tabId: number
  url: string
  title: string
  isActive: boolean
}

interface BrowserTabsResponse {
  tabs: BrowserTab[]
  degraded: boolean
  message?: string
}

export const useBrowserTabs = createQuery<
  BrowserTabsResponse,
  { surface: 'employee' | 'channel'; surfaceId: string }
>({
  queryKey: ['browseros', 'tabs'],
  fetcher: ({ surface, surfaceId }) =>
    $tabs({ query: { surface, surfaceId } }).then(
      parseResponse<BrowserTabsResponse>,
    ),
  // Reuses cached tabs across rapid picker re-opens — typing `@member` in
  // a channel won't fire a fresh list_pages MCP round-trip on every
  // backspace/retype within this window. Picker dismiss + reopen past
  // 5s still refetches.
  staleTime: 5_000,
})
