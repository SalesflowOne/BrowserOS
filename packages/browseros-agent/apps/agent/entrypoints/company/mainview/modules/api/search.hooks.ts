import { useDebouncedValue } from '@company/lib/useDebouncedValue'
import type { InferResponseType } from 'hono/client'
import { createQuery } from 'react-query-kit'
import { api } from './client'
import { parseResponse } from './parseResponse'

const $search = api.search.$get

export type SearchResults = InferResponseType<typeof $search>

const useSearchQuery = createQuery<SearchResults, { q: string }>({
  queryKey: ['search'],
  fetcher: ({ q }) =>
    $search({ query: { q: q, limit: '20' } }).then(
      parseResponse<SearchResults>,
    ),
})

interface UseSearchResult {
  data: SearchResults | undefined
  // True while the debounced query is in flight. Consumed by the
  // palette to distinguish "no results yet" (fetching, data is
  // undefined) from "no results at all" (settled, data is empty).
  isFetching: boolean
}

/**
 * Debounced search hook. Pass the raw input text; the hook trims +
 * debounces 150ms and only fires when the result is at least 2 chars
 * (the route returns 400 below 2, which we want to skip cleanly
 * rather than surface as an error state). Cached 30s so quickly
 * re-typing a recent query hits the cache.
 */
export function useSearch(rawQuery: string): UseSearchResult {
  const q = useDebouncedValue(rawQuery.trim(), 150)
  const enabled = q.length >= 2
  const result = useSearchQuery({
    variables: { q },
    enabled,
    staleTime: 30_000,
    // Hold the previous query's results while a new query is in
    // flight so the palette doesn't flash "No results" between
    // keystrokes. Spotlight / Linear / Raycast all do this.
    placeholderData: (prev) => prev,
  })
  return {
    data: enabled ? result.data : undefined,
    isFetching: enabled && result.isFetching,
  }
}
