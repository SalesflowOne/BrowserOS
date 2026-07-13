/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Boot-time URL migration for the shared BrowserClaw MCP server.
 *
 * When the proxy or bind port changes between runs, the canonical MCP
 * URL moves. Walk the manager manifest, find the shared `BrowserClaw`
 * entry written by the live connection routes, and re-link each harness
 * with a fresh spec. Other managed entries are outside this runtime's
 * current connection model and are deliberately ignored.
 *
 * Failures are isolated per harness so one unwritable config does not
 * prevent the remaining links from advancing. The migration is
 * idempotent once the shared spec already contains `targetMcpUrl`.
 */

import type { BoundApi, McpServerSpec } from '@browseros/agent-mcp-manager'
import { BROWSEROS_MCP_SERVER_NAME } from '../shared/mcp-url'
import { logger } from './logger'
import { getMcpManager } from './mcp-manager'

interface MigrationCounters {
  migrated: number
  skipped: number
  failed: number
}

export async function migrateMcpUrls(
  targetMcpUrl: string,
): Promise<MigrationCounters> {
  const mgr = getMcpManager()
  const counters: MigrationCounters = { migrated: 0, skipped: 0, failed: 0 }
  const servers = await safeList(mgr)
  if (servers === null) return counters

  const server = servers.find(
    (entry) => entry.name === BROWSEROS_MCP_SERVER_NAME,
  )
  if (!server) return counters

  const currentUrl = extractSpecUrl(server.spec)
  if (currentUrl === null || currentUrl === targetMcpUrl) {
    counters.skipped++
    return counters
  }

  const nextSpec = rewriteSpecUrl(server.spec, targetMcpUrl)
  for (const agent of Object.keys(server.links)) {
    const ok = await relinkOne(mgr, nextSpec, agent, currentUrl, targetMcpUrl)
    if (ok) counters.migrated++
    else counters.failed++
  }
  return counters
}

async function safeList(
  mgr: BoundApi,
): Promise<Awaited<ReturnType<BoundApi['list']>> | null> {
  try {
    return await mgr.list()
  } catch (err) {
    logger.warn('mcpUrl migration: manifest list failed', {
      error: err instanceof Error ? err.message : String(err),
    })
    return null
  }
}

async function relinkOne(
  mgr: BoundApi,
  nextSpec: McpServerSpec,
  agent: string,
  fromUrl: string,
  toUrl: string,
): Promise<boolean> {
  try {
    await mgr.link({
      server: { name: BROWSEROS_MCP_SERVER_NAME, spec: nextSpec },
      // biome-ignore lint/suspicious/noExplicitAny: manifest keys are catalog AgentIds behind the manager's opaque list type
      agent: agent as any,
      allowOverwrite: true,
    })
    logger.info('mcpUrl migration: relinked', {
      serverName: BROWSEROS_MCP_SERVER_NAME,
      agent,
      from: fromUrl,
      to: toUrl,
    })
    return true
  } catch (err) {
    logger.warn('mcpUrl migration: relink failed', {
      serverName: BROWSEROS_MCP_SERVER_NAME,
      agent,
      error: err instanceof Error ? err.message : String(err),
    })
    return false
  }
}

function extractSpecUrl(spec: McpServerSpec): string | null {
  if (spec.transport === 'http' || spec.transport === 'sse') return spec.url
  if (spec.transport === 'stdio') {
    const urlArg = spec.args?.find((a) => /^https?:\/\//.test(a))
    return urlArg ?? null
  }
  return null
}

function rewriteSpecUrl(spec: McpServerSpec, newUrl: string): McpServerSpec {
  if (spec.transport === 'http' || spec.transport === 'sse') {
    return { ...spec, url: newUrl }
  }
  // Rewrite only the first HTTP-like arg to match `extractSpecUrl`'s
  // `Array.find` semantics. A later HTTP arg may serve another purpose.
  const args = spec.args ?? []
  const firstUrlIdx = args.findIndex((a) => /^https?:\/\//.test(a))
  if (firstUrlIdx === -1) return { ...spec }
  const nextArgs = args.slice()
  nextArgs[firstUrlIdx] = newUrl
  return { ...spec, args: nextArgs }
}
