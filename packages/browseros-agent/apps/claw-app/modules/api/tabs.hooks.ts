/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Live-tab surface for the cockpit. `useTabs` polls the canonical tab
 * registry so the homepage can render which tabs each agent has
 * touched, how recently, and the tool sequence behind the current
 * state. The preview helpers build URLs to the binary JPEG route for
 * the per-tab screencast frames, loaded via <img src> because the
 * generated client is JSON-only.
 */

import type { Tab, TabList, ToolEvent } from '@browseros/claw-api'
import { useEffect, useState } from 'react'
import { createQuery } from 'react-query-kit'
import { apiClient, resolveApiBaseUrl } from './client'

export type { ToolEvent }
export type TabActivityRecord = Tab

export const useTabs = createQuery<TabList>({
  queryKey: ['api', 'tabs'],
  fetcher: async () => (await apiClient()).listTabs(),
  refetchInterval: 1500,
})

/**
 * The server ignores `capturedAt`; the param exists to key the URL to
 * one frame so an <img> notices a new capture and re-fetches instead
 * of reusing the browser-cached image.
 */
export function tabPreviewUrl(
  pageId: number,
  previewCapturedAt: number,
  baseUrl: string,
): string {
  return `${baseUrl}/api/v1/tabs/${pageId}/preview?capturedAt=${previewCapturedAt}`
}

/**
 * Null until the base URL resolves, and whenever the tab has no
 * captured frame yet (`previewCapturedAt` undefined); the screencast
 * surfaces map null to their placeholder state.
 */
export function useTabPreviewUrl(
  pageId: number,
  previewCapturedAt?: number,
): string | null {
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

  return baseUrl && previewCapturedAt !== undefined
    ? tabPreviewUrl(pageId, previewCapturedAt, baseUrl)
    : null
}
