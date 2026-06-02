import type { InferResponseType } from 'hono/client'
import { useEffect } from 'react'
import { createQuery } from 'react-query-kit'
import { API_BASE_URL, api } from './client'
import { parseResponse } from './parseResponse'
import { queryClient } from './queryClient'

const $list = api.announcements.$get

export type AnnouncementRow = InferResponseType<typeof $list>[number]

export const useAnnouncements = createQuery<AnnouncementRow[]>({
  queryKey: ['announcements'],
  fetcher: () => $list().then(parseResponse<AnnouncementRow[]>),
})

// Open one SSE connection per AnnouncementsView mount. New posts are
// prepended into the existing react-query cache instead of refetching;
// dedupe by id so a quick mount/unmount cycle doesn't double-insert
// rows that were already in the GET response.
export function useAnnouncementsStream(): void {
  useEffect(() => {
    const url = `${API_BASE_URL}/announcements/stream`
    const source = new EventSource(url)
    const handler = (e: MessageEvent) => {
      try {
        const row = JSON.parse(e.data) as AnnouncementRow
        queryClient.setQueryData<AnnouncementRow[]>(
          useAnnouncements.getKey(),
          (prev) => {
            if (!prev) return [row]
            if (prev.some((r) => r.id === row.id)) return prev
            return [row, ...prev]
          },
        )
      } catch {
        // Malformed event; next valid one will resync.
      }
    }
    source.addEventListener('announcement.posted', handler)
    return () => {
      source.removeEventListener('announcement.posted', handler)
      source.close()
    }
  }, [])
}
