/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Session audit surface for the cockpit and audit screens.
 *
 * useSessions        paginated session list (homepage + audit screen),
 *                    polled so live runs advance in place
 * useSessionDetail   one session's summary + full dispatch list;
 *                    polls only while the session is live
 *
 * taskScreenshotUrl builds the absolute URL to the binary screenshot
 * route so an <img src> can render the persisted JPEG without going
 * through the JSON client.
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

// The screens speak task-*; the contract speaks session-*. Aliased here
// so call sites keep their vocabulary while the shapes stay canonical.
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

/** Absolute URL for the persisted screenshot of one dispatch. */
export function taskScreenshotUrl(
  dispatchId: number,
  baseUrl = apiBaseUrl(),
): string {
  return `${baseUrl}/api/v1/dispatches/${dispatchId}/screenshot`
}

/**
 * Screenshot URL base that follows the BrowserOS server-port pref. The
 * pref API is callback-based, so `taskScreenshotUrl`'s sync default
 * cannot see it; components resolve the base here and pass it in.
 */
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
