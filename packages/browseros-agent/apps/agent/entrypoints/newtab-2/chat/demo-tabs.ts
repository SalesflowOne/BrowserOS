import { sentry } from '@/lib/sentry/sentry'
import {
  DEMO_PROFILE_URL,
  OPEN_REAL_TABS,
  TREND_SEARCH_KEYWORDS,
} from './demo-config'

let trendTabsOpened = false
let profileTabOpened = false

const linkedInContentSearch = (keyword: string): string =>
  `https://www.linkedin.com/search/results/content/?keywords=${encodeURIComponent(keyword)}`

const groupTabs = (tabIds: [number, ...number[]]): Promise<number> =>
  new Promise((resolve, reject) => {
    chrome.tabs.group({ tabIds }, (groupId) => {
      const error = chrome.runtime.lastError
      if (error) {
        reject(new Error(error.message))
        return
      }
      resolve(groupId)
    })
  })

const updateTabGroup = (
  groupId: number,
  updateProperties: chrome.tabGroups.UpdateProperties,
): Promise<void> =>
  new Promise((resolve, reject) => {
    chrome.tabGroups.update(groupId, updateProperties, () => {
      const error = chrome.runtime.lastError
      if (error) {
        reject(new Error(error.message))
        return
      }
      resolve()
    })
  })

/*
 * Tab group colors must be valid chrome.tabGroups.Color values.
 * Module flags prevent reopening within one page session; reload for a fresh take.
 * OPEN_REAL_TABS=false lets operators iterate on script timing without opening tabs.
 */
export async function openTrendTabs(): Promise<void> {
  if (!OPEN_REAL_TABS || trendTabsOpened) return
  trendTabsOpened = true
  try {
    const tabIds: number[] = []
    for (const keyword of TREND_SEARCH_KEYWORDS) {
      const tab = await chrome.tabs.create({
        url: linkedInContentSearch(keyword),
        active: false,
      })
      if (typeof tab.id === 'number') tabIds.push(tab.id)
    }
    const [firstTabId, ...restTabIds] = tabIds
    if (typeof firstTabId === 'number') {
      const groupId = await groupTabs([firstTabId, ...restTabIds])
      await updateTabGroup(groupId, {
        title: 'extracting trends',
        color: 'orange',
        collapsed: false,
      })
    }
  } catch (err) {
    sentry.captureException(err, {
      extra: { message: 'openTrendTabs failed' },
    })
  }
}

export async function openProfileTab(): Promise<void> {
  if (!OPEN_REAL_TABS || profileTabOpened) return
  profileTabOpened = true
  try {
    const tab = await chrome.tabs.create({
      url: DEMO_PROFILE_URL,
      active: false,
    })
    if (typeof tab.id === 'number') {
      const groupId = await groupTabs([tab.id])
      await updateTabGroup(groupId, {
        title: 'founder style / tone',
        color: 'blue',
      })
    }
  } catch (err) {
    sentry.captureException(err, {
      extra: { message: 'openProfileTab failed' },
    })
  }
}
