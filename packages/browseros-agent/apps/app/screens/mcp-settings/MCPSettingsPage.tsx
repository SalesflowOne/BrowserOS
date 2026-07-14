import type { FC } from 'react'
import { IntegrationsSection } from './IntegrationsSection'
import { MCPServerHeader } from './MCPServerHeader'
import { MCPToolsSection } from './MCPToolsSection'
import {
  useMcpServerUrl,
  useMcpTools,
  useReloadMcpServer,
} from './mcp-server.hooks'

/** @public */
export const MCPSettingsPage: FC = () => {
  const urlQuery = useMcpServerUrl()
  const serverUrl = urlQuery.data ?? null
  const toolsQuery = useMcpTools(urlQuery.isSuccess)
  const reloadServer = useReloadMcpServer()

  return (
    <div className="fade-in slide-in-from-bottom-5 animate-in space-y-6 duration-500">
      <MCPServerHeader
        serverUrl={serverUrl}
        isLoading={urlQuery.isPending}
        error={urlQuery.error ? urlQuery.error.message : null}
        onServerRestart={reloadServer}
      />

      <IntegrationsSection serverUrl={serverUrl} />

      <MCPToolsSection
        tools={toolsQuery.data ?? []}
        isLoading={toolsQuery.isFetching}
        error={toolsQuery.error ? toolsQuery.error.message : null}
        onRefresh={() => toolsQuery.refetch()}
      />
    </div>
  )
}
