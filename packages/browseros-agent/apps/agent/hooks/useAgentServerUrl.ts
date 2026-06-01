import { useEffect, useState } from 'react'
import { getAgentServerUrl } from '@/lib/browseros/helpers'

type UseAgentServerUrlResult =
  | { baseUrl: string; isLoading: false; error: null }
  | { baseUrl?: never; isLoading: true; error: null }
  | { baseUrl?: never; isLoading: false; error: Error }

/**
 * Resolves the local BrowserOS server URL used by React surfaces.
 * The host is always loopback; loading only represents waiting for the port.
 */
export function useAgentServerUrl(): UseAgentServerUrlResult {
  const [state, setState] = useState<UseAgentServerUrlResult>({
    isLoading: true,
    error: null,
  })

  useEffect(() => {
    let cancelled = false

    async function loadUrl() {
      try {
        const url = await getAgentServerUrl()
        if (!cancelled) {
          setState({ baseUrl: url, isLoading: false, error: null })
        }
      } catch (e) {
        if (!cancelled) {
          setState({
            isLoading: false,
            error: e instanceof Error ? e : new Error(String(e)),
          })
        }
      }
    }

    loadUrl()

    return () => {
      cancelled = true
    }
  }, [])

  return state
}
