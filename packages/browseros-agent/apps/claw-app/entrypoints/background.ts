/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { defineBackground } from 'wxt/utils/define-background'
import { resolveBrowserOSServerBaseUrl } from '@/modules/api/browseros-ports'
import { createRecordingsRelay } from '@/modules/recorder'

/** Tags recorder batches with the sender tab and relays them to the local server. */
export default defineBackground(() => {
  const relay = createRecordingsRelay({
    resolveServerBaseUrl: resolveBrowserOSServerBaseUrl,
  })
  const requestResnapshot = (tabId: number) => {
    try {
      void chrome.tabs
        .sendMessage(tabId, { type: 'recorder-resnapshot' })
        .catch(() => {})
    } catch {}
  }

  relay.onTabRecoveredAfterLoss(requestResnapshot)

  chrome.runtime.onMessage.addListener((message, sender) => {
    const recorderMessage = message as {
      type?: unknown
      ndjson?: unknown
    }
    const tabId = sender.tab?.id
    if (
      recorderMessage.type !== 'recorder-events' ||
      typeof recorderMessage.ndjson !== 'string' ||
      typeof tabId !== 'number'
    ) {
      return false
    }
    void relay.post(tabId, recorderMessage.ndjson)
    return false
  })

  // Background memory owns the retry queue, so every restart means surviving
  // documents need a new checkpoint after any batches that died with it.
  void chrome.tabs
    .query({})
    .then((tabs) => {
      for (const tab of tabs) {
        if (typeof tab.id === 'number') requestResnapshot(tab.id)
      }
    })
    .catch(() => {})
})
