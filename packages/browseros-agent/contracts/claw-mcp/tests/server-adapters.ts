/**
 * Boots each claw server for the cross-server MCP suite through its
 * REAL entrypoint — `bun apps/claw-server/src/main.ts` and the
 * `claw-server-rust` binary — attached to the harness browser's CDP
 * port via a temp sidecar JSON. This is deliberately not the seeded
 * `contract-server` example the claw-api suite uses: these tests
 * generate real state by driving `/mcp` against a live browser.
 *
 * Every subprocess runs with HOME (and friends) pointed into a temp
 * dir: the TS server's self-heal loops rewrite agent MCP configs under
 * the real `$HOME` otherwise, and both servers persist audit/session
 * state under `BROWSERCLAW_DIR`. `BROWSEROS_DIR` is pinned too so
 * spill files land somewhere each test can assert on.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { findFreePort } from './browser'

const MONOREPO_ROOT = resolve(import.meta.dir, '../../..')
const HEALTH_ATTEMPTS = 150
const HEALTH_INTERVAL_MS = 200
const STOP_GRACE_MS = 6_000
const LOG_TAIL_LINES = 40

export type ServerName = 'typescript' | 'rust'

export interface ContractServer {
  name: ServerName
  baseUrl: string
  /** Where this server writes spill files: `<dir>/tool-output/`. */
  toolOutputDir: string
  /** Sandboxed home — downloads and other per-user paths live under it. */
  homeDir: string
  stop(): Promise<void>
}

interface SpawnedServer {
  child: Bun.Subprocess<'ignore', 'pipe', 'pipe'>
  logTail(): string
}

function watchLogs(
  child: Bun.Subprocess<'ignore', 'pipe', 'pipe'>,
): () => string {
  const lines: string[] = []
  const consume = async (stream: ReadableStream<Uint8Array>) => {
    const decoder = new TextDecoder()
    let pending = ''
    for await (const chunk of stream) {
      pending += decoder.decode(chunk, { stream: true })
      const parts = pending.split('\n')
      pending = parts.pop() ?? ''
      lines.push(...parts)
      if (lines.length > LOG_TAIL_LINES) {
        lines.splice(0, lines.length - LOG_TAIL_LINES)
      }
    }
    if (pending) lines.push(pending)
  }
  void consume(child.stdout)
  void consume(child.stderr)
  return () => lines.join('\n')
}

async function sandboxEnv(root: string): Promise<Record<string, string>> {
  const home = join(root, 'home')
  await mkdir(join(home, '.config'), { recursive: true })
  return {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: join(home, '.config'),
    CLAUDE_CONFIG_DIR: home,
    APPDATA: join(home, 'AppData', 'Roaming'),
    LOCALAPPDATA: join(home, 'AppData', 'Local'),
    BROWSERCLAW_DIR: join(root, 'browserclaw'),
    BROWSEROS_DIR: join(root, 'browseros'),
    CLAW_ANALYTICS_ENABLED: 'false',
  }
}

async function writeSidecar(
  root: string,
  serverPort: number,
  cdpPort: number,
): Promise<string> {
  const resources = join(root, 'resources')
  await mkdir(resources, { recursive: true })
  const path = join(root, 'sidecar.json')
  await writeFile(
    path,
    JSON.stringify({
      ports: { server: serverPort, cdp: cdpPort },
      directories: { resources },
      flags: { devMode: false },
    }),
  )
  return path
}

async function waitUntilHealthy(
  baseUrl: string,
  spawned: SpawnedServer,
  label: string,
): Promise<void> {
  for (let attempt = 0; attempt < HEALTH_ATTEMPTS; attempt += 1) {
    if (spawned.child.exitCode !== null) {
      throw new Error(
        `${label} exited with ${spawned.child.exitCode} before becoming healthy:\n${spawned.logTail()}`,
      )
    }
    try {
      const response = await fetch(`${baseUrl}/system/health`, {
        signal: AbortSignal.timeout(1_000),
      })
      if (response.ok) return
    } catch {}
    await Bun.sleep(HEALTH_INTERVAL_MS)
  }
  spawned.child.kill(9)
  throw new Error(`${label} never became healthy:\n${spawned.logTail()}`)
}

async function stopServer(spawned: SpawnedServer, root: string): Promise<void> {
  const { child } = spawned
  if (child.exitCode === null) {
    child.kill()
    const forceKill = setTimeout(() => child.kill(9), STOP_GRACE_MS)
    await child.exited
    clearTimeout(forceKill)
  }
  await rm(root, { recursive: true, force: true })
}

async function startServer(
  name: ServerName,
  cmd: string[],
  cdpPort: number,
  tmpPrefix: string,
): Promise<ContractServer> {
  const root = await mkdtemp(join(tmpdir(), tmpPrefix))
  const serverPort = await findFreePort()
  const sidecar = await writeSidecar(root, serverPort, cdpPort)
  const child = Bun.spawn({
    cmd: [...cmd, '--config', sidecar],
    cwd: MONOREPO_ROOT,
    env: await sandboxEnv(root),
    stdout: 'pipe',
    stderr: 'pipe',
  }) as Bun.Subprocess<'ignore', 'pipe', 'pipe'>
  const spawned: SpawnedServer = { child, logTail: watchLogs(child) }
  const baseUrl = `http://127.0.0.1:${serverPort}`
  try {
    await waitUntilHealthy(baseUrl, spawned, `${name} claw server`)
  } catch (error) {
    await stopServer(spawned, root)
    throw error
  }
  return {
    name,
    baseUrl,
    toolOutputDir: join(root, 'browseros', 'tool-output'),
    homeDir: join(root, 'home'),
    stop: () => stopServer(spawned, root),
  }
}

export async function startTypeScriptServer(
  cdpPort: number,
): Promise<ContractServer> {
  return await startServer(
    'typescript',
    ['bun', 'apps/claw-server/src/main.ts'],
    cdpPort,
    'claw-mcp-ts-',
  )
}

export const RUST_BINARY = resolve(
  MONOREPO_ROOT,
  'target/debug/browseros-claw-server-rs',
)

/**
 * Debug-profile build matching the claw-api suite's choice; `run.ts`
 * pre-builds so test timeouts never absorb a cold cargo build.
 */
export function buildRustServer(): void {
  const build = Bun.spawnSync({
    cmd: ['cargo', 'build', '--locked', '-p', 'claw-server-rust'],
    cwd: MONOREPO_ROOT,
    stdout: 'inherit',
    stderr: 'inherit',
  })
  if (build.exitCode !== 0) {
    throw new Error(
      `cargo build -p claw-server-rust failed (${build.exitCode})`,
    )
  }
}

export async function startRustServer(
  cdpPort: number,
): Promise<ContractServer> {
  if (!(await Bun.file(RUST_BINARY).exists())) {
    buildRustServer()
  }
  return await startServer('rust', [RUST_BINARY], cdpPort, 'claw-mcp-rust-')
}

export function startContractServer(
  name: ServerName,
  cdpPort: number,
): Promise<ContractServer> {
  return name === 'typescript'
    ? startTypeScriptServer(cdpPort)
    : startRustServer(cdpPort)
}
