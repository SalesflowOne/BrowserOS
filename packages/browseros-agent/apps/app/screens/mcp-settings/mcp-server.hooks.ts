import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getMcpServerUrl } from '@/lib/browseros/helpers'
import type { McpTool } from '@/lib/mcp/client'
import { sendServerMessage } from '@/lib/messaging/server/serverMessages'

const MCP_SERVER_URL_KEY = ['mcp', 'server-url'] as const
const MCP_TOOLS_KEY = ['mcp', 'tools'] as const

/** Resolves the proxy-facing MCP endpoint from the live server-port pref. */
export function useMcpServerUrl() {
  return useQuery({
    queryKey: MCP_SERVER_URL_KEY,
    queryFn: getMcpServerUrl,
    staleTime: 30_000,
  })
}

/**
 * Lists the tools the MCP server exposes. The fetch goes through the
 * background messaging bridge, which resolves the live port itself, so
 * a refetch always targets the current server. Gate with `enabled`
 * until the server URL has resolved so we do not probe a port that is
 * not configured yet. Cached and deduped by react-query, so remounting
 * the settings page reuses the cache instead of refetching on a loop.
 */
export function useMcpTools(enabled: boolean) {
  return useQuery({
    queryKey: MCP_TOOLS_KEY,
    enabled,
    staleTime: 5_000,
    queryFn: async (): Promise<McpTool[]> => {
      const result = await sendServerMessage('fetchMcpTools', undefined)
      if (result.error) throw new Error(result.error)
      return result.tools
    },
  })
}

/**
 * Reload after a server restart. The port, and therefore the exposed
 * tool set, can change, so the URL is invalidated and the tools cache
 * is reset to empty before it refetches. Resetting (rather than a plain
 * invalidate) guarantees stale tools never linger during the refetch or
 * survive a failed one.
 */
export function useReloadMcpServer() {
  const queryClient = useQueryClient()
  return async () => {
    await queryClient.invalidateQueries({ queryKey: MCP_SERVER_URL_KEY })
    await queryClient.resetQueries({ queryKey: MCP_TOOLS_KEY })
  }
}
