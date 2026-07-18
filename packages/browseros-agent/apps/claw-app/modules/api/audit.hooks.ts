/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Canonical session queries and dispatch-artifact URL helpers.
 */

import type {
  Dispatch,
  SessionDetail,
  SessionList,
  SessionStatus,
  SessionSummary,
} from '@browseros/claw-api'
import { useEffect, useState } from 'react'
import { createInfiniteQuery, createQuery } from 'react-query-kit'
import { apiBaseUrl, apiClient, resolveApiBaseUrl } from './client'

export type ToolDispatchRow = Dispatch
export type TaskStatus = SessionStatus
export type TaskSummary = SessionSummary
export type TaskDetail = SessionDetail

export interface UseSessionsVariables {
  profileId?: string
  slug?: string
  status?: SessionStatus
  site?: string
  search?: string
  since?: number
  limit?: number
}

export const useSessions = createInfiniteQuery<
  SessionList,
  UseSessionsVariables,
  Error,
  number | undefined
>({
  queryKey: ['api', 'sessions'],
  fetcher: async (variables, { pageParam }) =>
    (await apiClient()).listSessions({
      ...variables,
      ...(pageParam === undefined ? {} : { cursor: pageParam }),
    }),
  initialPageParam: undefined,
  getNextPageParam: (last) => last.nextCursor,
  refetchInterval: 3000,
  // Keep the prior pages visible while a new filter set loads so the
  // adjacent filter controls remain mounted and retain keyboard focus.
  placeholderData: (previous) => previous,
})

export const useSessionDetail = createQuery<
  SessionDetail,
  { sessionId: string },
  Error
>({
  queryKey: ['api', 'session'],
  fetcher: async ({ sessionId }) =>
    (await apiClient()).getSession({ sessionId }),
  refetchInterval: (query) =>
    query.state.data?.session.status === 'live' ? 3000 : false,
})

export function taskScreenshotUrl(
  dispatchId: number,
  baseUrl = apiBaseUrl(),
): string {
  return `${baseUrl}/api/v1/dispatches/${dispatchId}/screenshot`
}

export function useTaskScreenshotBaseUrl(): string | null {
  const [baseUrl, setBaseUrl] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    resolveApiBaseUrl().then((resolved) => {
      if (active) setBaseUrl(resolved)
    })
    return () => {
      active = false
    }
  }, [])

  return baseUrl
}
