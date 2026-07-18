/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Canonical live-tab query and binary preview URL helpers.
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

export function tabPreviewUrl(
  pageId: number,
  previewCapturedAt: number,
  baseUrl: string,
): string {
  return `${baseUrl}/api/v1/tabs/${pageId}/preview?capturedAt=${previewCapturedAt}`
}

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
