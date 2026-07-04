/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { ensureClaudeCodeHttpTransportTag } from '@browseros/shared/mcp/claude-code-transport-tag'
import { logger } from '../lib/logger'
import { getMcpManager } from '../lib/mcp-manager'
import { BROWSEROS_MCP_SERVER_NAME } from '../shared/mcp-url-common'

const LEGACY_BROWSEROS_MCP_SERVER_NAME = 'browseros'

export async function healClaudeCodeTransportTags(): Promise<number> {
  const mgr = getMcpManager()
  const [servers, links] = await Promise.all([
    mgr.listServers(),
    mgr.listLinks(),
  ])
  const httpServers = new Set(
    servers
      .filter((server) => server.spec.transport === 'http')
      .map((server) => server.name),
  )
  let healed = 0

  for (const link of links) {
    if (link.agent !== 'claude-code') continue
    if (!httpServers.has(link.serverName)) continue
    if (!link.configPath) continue

    for (const serverName of claudeCodeServerNamesToHeal(link.serverName)) {
      const changed = await ensureClaudeCodeHttpTransportTag({
        configPath: link.configPath,
        serverName,
        logger,
      })
      if (changed) healed++
    }
  }

  return healed
}

function claudeCodeServerNamesToHeal(serverName: string): string[] {
  if (
    serverName !== BROWSEROS_MCP_SERVER_NAME &&
    serverName !== LEGACY_BROWSEROS_MCP_SERVER_NAME
  ) {
    return [serverName]
  }
  return Array.from(
    new Set([
      serverName,
      BROWSEROS_MCP_SERVER_NAME,
      LEGACY_BROWSEROS_MCP_SERVER_NAME,
    ]),
  )
}
