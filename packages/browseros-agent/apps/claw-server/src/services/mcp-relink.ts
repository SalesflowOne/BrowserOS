/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Choke-point relink for a managed MCP server. Connect and profile
 * install paths funnel through here; direct boot repair links call
 * the exported transport-tag helper below. On failure, restores the
 * previous link so a partial write does not orphan the entry.
 *
 * agent-mcp-manager 0.0.4-rc.3 omits Claude Code's required
 * `type: "http"` transport tag, so the shared add-only repair runs
 * immediately after the managed write.
 */

import { ensureClaudeCodeHttpTransportTag } from '@browseros/shared/mcp/claude-code-transport-tag'
import type {
  AgentId,
  BoundApi,
  LinkPlanSummary,
  McpServerSpec,
} from 'agent-mcp-manager'
import { logger } from '../lib/logger'

interface RelinkManagedServerOptions {
  mgr: BoundApi
  serverName: string
  agent: AgentId
  spec: McpServerSpec
  allowOverwrite?: boolean
}

/** Rewrites a managed MCP link for URL drift and restores the old link if replacement fails. */
export async function relinkManagedServer({
  mgr,
  serverName,
  agent,
  spec,
  allowOverwrite,
}: RelinkManagedServerOptions): Promise<LinkPlanSummary> {
  const previousSpec = await findExistingSpec(mgr, serverName)
  try {
    const result = await mgr.link({
      server: { name: serverName, spec },
      agent,
      ...(allowOverwrite ? { allowOverwrite } : {}),
    })
    await tagClaudeCodeHttpEntry(mgr, agent, spec, serverName)
    return result
  } catch (err) {
    if (previousSpec) {
      try {
        await mgr.link({
          server: { name: serverName, spec: previousSpec },
          agent,
          ...(allowOverwrite ? { allowOverwrite } : {}),
        })
        await tagClaudeCodeHttpEntry(mgr, agent, previousSpec, serverName)
      } catch (restoreErr) {
        const relinkMessage = err instanceof Error ? err.message : String(err)
        const restoreMessage =
          restoreErr instanceof Error ? restoreErr.message : String(restoreErr)
        throw new Error(
          `Could not relink ${serverName}: ${relinkMessage}; also failed to restore previous link: ${restoreMessage}`,
        )
      }
    }
    throw err
  }
}

export async function tagClaudeCodeHttpEntry(
  mgr: BoundApi,
  agent: AgentId,
  spec: McpServerSpec,
  serverName: string,
): Promise<void> {
  if (agent !== 'claude-code' || spec.transport !== 'http') return

  try {
    const links = await mgr.listLinks({
      serverNames: [serverName],
      agents: [agent],
    })
    const configPath = links.find(
      (link) => link.serverName === serverName && link.agent === agent,
    )?.configPath
    if (!configPath) {
      logger.warn('Claude Code MCP link path missing; skipped transport tag', {
        serverName,
      })
      return
    }
    await ensureClaudeCodeHttpTransportTag({
      configPath,
      serverName,
      expectedUrl: spec.url,
      onlyIfMissing: true,
      logger,
    })
  } catch (err) {
    logger.warn('Failed to locate Claude Code MCP config for transport tag', {
      serverName,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

async function findExistingSpec(
  mgr: BoundApi,
  serverName: string,
): Promise<McpServerSpec | null> {
  const servers = await mgr.list()
  return servers.find((server) => server.name === serverName)?.spec ?? null
}
