import { execFile, spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { DB } from '../../db/types.js'
import { saveBrowserosMcpUrl } from '../settings/browseros.js'

// Probe-first design (mirrors browseros-cli):
//
// We *discover* the running BrowserOS rather than dictating its
// profile or port. This lets the agent reuse the user's default
// BrowserOS profile — cookies, logins, extensions — without
// fighting Chromium's single-instance lock.
//
// Resolution order:
//   1. ~/.browseros/server.json — authoritative. BrowserOS writes
//      the URL clients should hit; the CLI uses the same source.
//   2. Common BrowserOS dev ports (9100/9200/9300) — last-resort
//      fallback for builds that didn't write server.json yet.
//
// When nothing is reachable we cold-spawn via Launch Services:
// `open -b com.browseros.BrowserOS` (no flags). Launch Services
// handles path lookup across BrowserOS.app / BrowserOS copy.app /
// BrowserOS-Dev.app variants, BrowserOS picks its own port and
// writes server.json, and the next probe tick reads it. We don't
// pass --browseros-proxy-port or --browseros-dock-icon because
// neither changes what server.json announces, so they only added
// confusion (a "preferred port" that wasn't actually preferred).
//
// macOS-only for v1. Windows/Linux short-circuit to 'skipped'.
//
// Filesystem note: the DMG build ships without app-sandbox
// entitlements, so reading $HOME/.browseros/server.json works in
// the packaged app exactly like it does in `bun dev`. A future
// switch to a Mac App Store target (`target: mas`) or an explicit
// `app-sandbox` entitlement would break this — add a
// `temporary-exception.files.absolute-path.read-only` entitlement
// covering ~/.browseros/ if that ever happens.

const execFileAsync = promisify(execFile)

const BUNDLE_ID = 'com.browseros.BrowserOS'
const SERVER_DISCOVERY_FILE = join('.browseros', 'server.json')
// Fallback ports for builds that don't write server.json — kept in
// sync with browseros-cli's `commonBrowserOSPorts`.
const FALLBACK_PORTS: readonly number[] = [9100, 9200, 9300]

const HEALTH_TIMEOUT_MS = 2_000
const SPAWN_WAIT_TIMEOUT_MS = 30_000
const SPAWN_POLL_INTERVAL_MS = 1_000

type ResolutionSource = 'already-running' | 'spawned'

export type EnsureBrowserosStatus =
  | { status: 'reachable'; mcpUrl: string; via: ResolutionSource }
  | { status: 'not-installed' }
  | { status: 'spawn-failed'; reason: string }
  | { status: 'spawn-timed-out' }
  | { status: 'skipped'; reason: string }

export interface ProbeOptions {
  homeDir?: string
  candidatePorts?: readonly number[]
}

/**
 * Resolve or spawn the agent BrowserOS; never throws — fire-and-forget.
 *
 * `options` is exposed so tests can inject a hermetic home dir and
 * candidate-port list; production callers pass nothing.
 */
export async function ensureBrowserosRunning(
  db: DB,
  options: ProbeOptions = {},
): Promise<EnsureBrowserosStatus> {
  if (process.platform !== 'darwin') {
    return {
      status: 'skipped',
      reason: `auto-start not implemented for ${process.platform}`,
    }
  }

  const existing = await probeRunningBrowseros(options)
  if (existing) return persistResolved(db, existing, 'already-running')

  const launcher = await findLauncher()
  if (!launcher) return { status: 'not-installed' }

  try {
    await startBrowseros(launcher)
  } catch (err) {
    return {
      status: 'spawn-failed',
      reason: err instanceof Error ? err.message : String(err),
    }
  }

  const fresh = await waitForServer(options)
  if (fresh) return persistResolved(db, fresh, 'spawned')
  return { status: 'spawn-timed-out' }
}

/**
 * Discover a running BrowserOS via the discovery file and a fixed
 * list of candidate ports. Returns the base URL (no trailing /mcp)
 * or null if nothing's listening.
 *
 * Exported for tests; production callers should go through
 * `ensureBrowserosRunning` so a discovery also persists into app
 * settings.
 */
export async function probeRunningBrowseros(
  options: ProbeOptions = {},
): Promise<string | null> {
  const home = options.homeDir ?? homedir()
  const candidatePorts = options.candidatePorts ?? FALLBACK_PORTS

  const announced = await readAnnouncedUrl(home)
  if (announced && (await healthCheck(announced))) return announced

  for (const port of candidatePorts) {
    const url = `http://127.0.0.1:${port}`
    if (await healthCheck(url)) return url
  }
  return null
}

/** One-line boot banner describing the auto-start outcome. */
export function logEnsureBrowserosResult(result: EnsureBrowserosStatus): void {
  switch (result.status) {
    case 'reachable':
      // biome-ignore lint/suspicious/noConsole: boot-time visibility, mirrors the API URL banner
      console.log(`[browseros] reachable at ${result.mcpUrl} (${result.via})`)
      return
    case 'not-installed':
      // biome-ignore lint/suspicious/noConsole: surface install hint
      console.warn(
        '[browseros] not installed — agent web tools will fail until BrowserOS is installed',
      )
      return
    case 'spawn-failed':
      // biome-ignore lint/suspicious/noConsole: surface spawn failures
      console.warn(`[browseros] spawn failed: ${result.reason}`)
      return
    case 'spawn-timed-out':
      // biome-ignore lint/suspicious/noConsole: surface readiness timeouts
      console.warn(
        '[browseros] launched but no server responded within the deadline',
      )
      return
    case 'skipped':
      // biome-ignore lint/suspicious/noConsole: surface platform skip
      console.warn(`[browseros] auto-start skipped: ${result.reason}`)
      return
  }
}

async function persistResolved(
  db: DB,
  baseUrl: string,
  via: ResolutionSource,
): Promise<EnsureBrowserosStatus> {
  const mcpUrl = await saveBrowserosMcpUrl(db, `${baseUrl}/mcp`)
  return { status: 'reachable', mcpUrl, via }
}

async function waitForServer(options: ProbeOptions): Promise<string | null> {
  const deadline = Date.now() + SPAWN_WAIT_TIMEOUT_MS
  while (Date.now() < deadline) {
    const url = await probeRunningBrowseros(options)
    if (url) return url
    await sleep(SPAWN_POLL_INTERVAL_MS)
  }
  return null
}

async function readAnnouncedUrl(home: string): Promise<string | null> {
  try {
    const raw = await readFile(join(home, SERVER_DISCOVERY_FILE), 'utf8')
    const parsed = JSON.parse(raw) as { url?: unknown; server_port?: unknown }
    if (typeof parsed.url === 'string' && parsed.url) {
      return parsed.url.replace(/\/$/, '')
    }
    if (typeof parsed.server_port === 'number') {
      return `http://127.0.0.1:${parsed.server_port}`
    }
    return null
  } catch {
    return null
  }
}

async function healthCheck(baseUrl: string): Promise<boolean> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS)
  try {
    const res = await fetch(`${baseUrl}/health`, {
      method: 'GET',
      signal: controller.signal,
    })
    return res.status === 200
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

interface Launcher {
  cmd: string
  args: string[]
}

async function findLauncher(): Promise<Launcher | null> {
  // biome-ignore lint/style/noProcessEnv: dev-only override matching the BROWSEROS_BINARY convention in the BrowserOS eval runner
  const override = process.env.BROWSEROS_BINARY?.trim()
  if (override) return { cmd: override, args: [] }

  // `open -Ra <name>` queries Launch Services without launching — same
  // installation check as browseros-cli. Returns non-zero (rejected)
  // when BrowserOS isn't registered with macOS.
  try {
    await execFileAsync('open', ['-Ra', 'BrowserOS'])
  } catch {
    return null
  }

  // `open -b <bundle-id>` defers to Launch Services to resolve and
  // start the app (BrowserOS.app, BrowserOS copy.app, wherever the
  // user installed it). No --args: BrowserOS picks its own port and
  // announces it via ~/.browseros/server.json, which the probe reads
  // back. Matches browseros-cli's launch flow exactly.
  return { cmd: 'open', args: ['-b', BUNDLE_ID] }
}

async function startBrowseros(launcher: Launcher): Promise<void> {
  // detached + unref so our Electron quit doesn't kill the child — the user
  // may still want BrowserOS open after closing the app.
  const child = spawn(launcher.cmd, launcher.args, {
    detached: true,
    stdio: 'ignore',
  })
  // ENOENT / EACCES / wrong-arch failures surface as an *async* 'error'
  // event. Without a listener Node throws on the EventEmitter and the
  // main process crashes. Race the error against one tick: if no error
  // fires by then, treat the spawn as successful and let the health
  // poll do the rest. Late errors land on a no-op handler.
  await new Promise<void>((resolve, reject) => {
    const onError = (err: Error) => reject(err)
    child.once('error', onError)
    setImmediate(() => {
      child.off('error', onError)
      child.on('error', () => {})
      resolve()
    })
  })
  child.unref()
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
