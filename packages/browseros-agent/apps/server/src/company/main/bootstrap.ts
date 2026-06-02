import { logger } from '../../lib/logger'
import { initializeDatabase } from '../db/index.js'
import { ensureBrowserosRunning } from './browseros/process-manager.js'
import { getChannelOrchestrator } from './channels/orchestrator.js'
import { primeAcpxOverrides } from './chat/acpx-provider.js'
import { resolveStableBinary } from './chat/binary-resolver.js'
import { recoverInterruptedTurns } from './chat/recovery.js'
import { setDb } from './db-singleton.js'
import { setLocalServerUrl } from './local-server-url.js'
import { ensureWorkspacesUpToDate } from './memory/ensure-workspaces.js'
import { setOwnServerMcpUrl } from './settings/browseros.js'
import { ensureBuiltInSkills } from './skills/ensure-built-ins.js'
import { ensureUserSkillsLinked } from './skills/ensure-user-skills.js'
import { handleIncomingTelegramMessage } from './telegram/bridge.js'
import { getTelegramManager } from './telegram/manager.js'
import { getOutboundMirror } from './telegram/outbound-mirror.js'

interface BootstrapOptions {
  /** Port the BrowserOS HTTP server is listening on. The company router is
   *  mounted under `/company`, so in-process MCP endpoints (nudge,
   *  browserclaw, per-channel) resolve to `http://127.0.0.1:<port>/company/...`. */
  serverPort: number
}

/**
 * Boots the "company" domain (employees-as-agents: threads, channels,
 * skills, telegram) inside the BrowserOS server process. This is the
 * server-runtime replacement for the Electron `main()` entry — it does
 * everything that wasn't tied to a desktop window/tray/updater.
 *
 * Safe to call exactly once after the HTTP server is listening. DB init is
 * awaited (route handlers depend on the singleton); the rest are
 * fire-and-forget so server boot never blocks on skill/workspace/telegram
 * warm-up.
 */
export async function bootstrapCompany({
  serverPort,
}: BootstrapOptions): Promise<void> {
  const { db } = await initializeDatabase()
  setDb(db)

  // acpx hijacks `process.execPath` as its child interpreter, expecting a
  // plain `node`. Under Bun that's the bun binary, so re-point it at the
  // resolved node so spawned claude/codex ACP agents launch correctly.
  const nodeBinary = await resolveStableBinary('node')
  if (nodeBinary) process.execPath = nodeBinary

  await primeAcpxOverrides()
  await recoverInterruptedTurns(db)

  // Routes are mounted under /company; in-process MCP servers build their
  // callback URLs off this base.
  const apiBaseUrl = `http://127.0.0.1:${serverPort}/company`
  setLocalServerUrl(apiBaseUrl)
  getChannelOrchestrator().setApiBaseUrl(apiBaseUrl)

  // The BrowserOS browser-automation MCP is this same binary's own /mcp
  // endpoint (same host + port). No external BrowserOS discovery and no
  // UI-configured port — the company agents drive the browser through the
  // server they're already part of.
  setOwnServerMcpUrl(`http://127.0.0.1:${serverPort}/mcp`)

  void ensureBuiltInSkills(db)
  void ensureUserSkillsLinked(db)
  void ensureWorkspacesUpToDate(db)

  // The Electron host auto-spawned BrowserOS via Launch Services when no
  // reachable instance was found. In the server runtime BrowserOS is the
  // host, so auto-spawn is opt-in (avoid launching a second browser).
  // biome-ignore lint/style/noProcessEnv: optional dev/ops toggle for legacy external-BrowserOS auto-spawn
  if (process.env.COMPANY_ENABLE_BROWSEROS_SPAWN === '1') {
    void ensureBrowserosRunning(db).catch((err) => {
      logger.warn('ensureBrowserosRunning failed', {
        error: err instanceof Error ? err.message : String(err),
      })
    })
  }

  const telegramManager = getTelegramManager()
  telegramManager.setMessageHandler(handleIncomingTelegramMessage)
  void telegramManager.startAll()
  void getOutboundMirror().startAll()

  logger.info('Company domain bootstrapped', { apiBaseUrl })
}
