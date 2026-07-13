/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Boot-time URL drift detector. When BrowserOS restarts on a
 * different port (port collision, bun reload, etc.) every agent
 * config that previously linked to BrowserOS still points at the
 * stale URL. The reconciler reads the manifest, compares the recorded
 * URL on each managed server entry against the just-bound URL, and if
 * they differ, re-links every previously-linked agent with the new
 * URL.
 *
 * Two manifest entries are managed independently:
 *   - `browseros` (HTTP spec for HTTP-native agents)
 *   - `browseros-stdio` (stdio spec wrapping `npx mcp-remote <url>`)
 *
 * Since 0.0.4, `link()` upserts the manifest spec and rewrites the
 * agent config in one call, so a single overwrite-link per still-
 * linked agent replaces the old remove + add + link dance (no window
 * where an agent is transiently disconnected). The Claude Code HTTP
 * `type` field is emitted by the catalog layer, so no post-write
 * fixup runs here.
 *
 * The reconciler is fire-and-forget at boot. Per-agent failures (e.g.
 * permission denied on someone's config directory) get warn-logged so
 * a single broken agent cannot block the others.
 */

import type {
  BoundApi,
  ManifestServerEntry,
  McpHttpSpec,
  McpStdioSpec,
} from '@browseros/agent-mcp-manager'
import { logger } from '../logger'
import {
  BROWSEROS_MCP_SERVER_NAME,
  BROWSEROS_MCP_STDIO_SERVER_NAME,
  getMcpManager,
} from './manager'
import type { McpAgentId, ReconcileResult } from './types'

export interface ReconcileUrlInput {
  /** The client-facing MCP URL, e.g. http://127.0.0.1:9100/mcp */
  currentUrl: string
}

/**
 * Extracts the embedded BrowserOS URL from a managed entry so the
 * reconciler can short-circuit when nothing drifted. Returns null for
 * shapes we don't recognise (e.g. user-edited spec).
 */
function recordedUrl(server: ManifestServerEntry): string | null {
  if (server.spec.transport === 'http' || server.spec.transport === 'sse') {
    return server.spec.url
  }
  if (server.spec.transport === 'stdio') {
    if (server.spec.command !== 'npx') return null
    const args = server.spec.args ?? []
    const idx = args.indexOf('mcp-remote')
    if (idx < 0) return null
    return args[idx + 1] ?? null
  }
  return null
}

/**
 * Rebuilds a server spec with a fresh URL while preserving its
 * transport flavour. Called per managed name when the URL drifted.
 */
function rebuildSpec(
  serverName: string,
  currentUrl: string,
): McpHttpSpec | McpStdioSpec {
  if (serverName === BROWSEROS_MCP_STDIO_SERVER_NAME) {
    return {
      transport: 'stdio',
      command: 'npx',
      args: ['mcp-remote', currentUrl],
    }
  }
  return { transport: 'http', url: currentUrl }
}

/**
 * Re-links each previously-linked agent against the freshly-rebuilt
 * spec. `link` upserts, so the manifest entry advances to the new URL
 * as each agent's config is rewritten. Per-agent failures get warn-
 * logged so a single broken config cannot block the others.
 */
async function relinkAgents(
  mgr: BoundApi,
  serverName: string,
  spec: McpHttpSpec | McpStdioSpec,
  agents: McpAgentId[],
): Promise<McpAgentId[]> {
  const relinked: McpAgentId[] = []
  for (const agent of agents) {
    try {
      await mgr.link({
        server: { name: serverName, spec },
        agent,
        allowOverwrite: true,
      })
      relinked.push(agent)
    } catch (err) {
      logger.warn('MCP manager failed to relink agent after URL drift', {
        agent,
        serverName,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }
  return relinked
}

export async function reconcileUrl(
  input: ReconcileUrlInput,
): Promise<ReconcileResult> {
  const mgr = getMcpManager()
  const servers = await mgr.list()
  const managedNames = [
    BROWSEROS_MCP_SERVER_NAME,
    BROWSEROS_MCP_STDIO_SERVER_NAME,
  ]
  const affected: McpAgentId[] = []
  let didAnything = false

  for (const name of managedNames) {
    const existing = servers.find((s) => s.name === name)
    if (!existing) continue
    if (recordedUrl(existing) === input.currentUrl) continue

    didAnything = true
    const previouslyLinked = Object.keys(existing.links) as McpAgentId[]
    const spec = rebuildSpec(name, input.currentUrl)
    affected.push(...(await relinkAgents(mgr, name, spec, previouslyLinked)))
  }

  if (!didAnything) {
    return { action: 'noop', affectedAgents: [] }
  }

  logger.info('MCP manager reconciled BrowserOS URL', {
    newUrl: input.currentUrl,
    relinked: affected,
  })
  return { action: 'updated', affectedAgents: affected }
}
