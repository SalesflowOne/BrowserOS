import { spawn } from 'node:child_process'
import {
  isSupportedAgentKind,
  SUPPORTED_AGENT_KINDS,
} from '../../shared/agents/capabilities.constants.js'
import { resolveStableBinary } from '../chat/binary-resolver.js'
import { displayFor } from './display.js'
import { probeNpxCache } from './npx-cache.js'
import { agentRegistry } from './registry.js'

export type AgentInstallState = 'installed' | 'npx-available' | 'not-installed'

export interface AgentDetection {
  agentId: string
  displayName: string
  installUrl: string
  installState: AgentInstallState
  version: string | null
  npxBased: boolean
}

const PROBE_TIMEOUT_MS = 3_000

const STATE_ORDER: Record<AgentInstallState, number> = {
  installed: 0,
  'npx-available': 1,
  'not-installed': 2,
}

interface ProbeOptions {
  binProbeOverride?: (
    bin: string,
    timeoutMs: number,
  ) => Promise<{ found: boolean; version: string | null }>
  npxProbeOverride?: (packageName: string) => Promise<boolean>
  timeoutMs?: number
}

/**
 * Probes every supported agent and reports whether it's installed as a
 * real binary, npx-cached and runnable without a network fetch, or
 * neither. Results are sorted by install state then by display name so
 * the UI can render the most-actionable entries first.
 *
 * Driven directly off `SUPPORTED_AGENT_KINDS` so the dropdown can
 * never silently omit an agent that the POST validator accepts. If a
 * supported agent isn't in the acpx registry yet the probe surfaces
 * as `not-installed`, which is what the user needs to see.
 *
 * The optional overrides exist purely as test seams; production
 * callers pass nothing.
 */
export async function detectAgents(
  opts: ProbeOptions = {},
): Promise<AgentDetection[]> {
  const binProbe = opts.binProbeOverride ?? probeBinary
  const npxProbe = opts.npxProbeOverride ?? probeNpxCache
  const timeout = opts.timeoutMs ?? PROBE_TIMEOUT_MS

  const results = await Promise.all(
    SUPPORTED_AGENT_KINDS.map((id) =>
      probeAgent(id, binProbe, npxProbe, timeout),
    ),
  )

  return results.sort((a, b) => {
    const byState = STATE_ORDER[a.installState] - STATE_ORDER[b.installState]
    if (byState !== 0) return byState
    return a.displayName.localeCompare(b.displayName)
  })
}

/** Hire-time gate; refuses any agent kind we don't power end-to-end. */
export function isKnownAgentId(value: string): boolean {
  return isSupportedAgentKind(value)
}

async function probeAgent(
  agentId: string,
  binProbe: NonNullable<ProbeOptions['binProbeOverride']>,
  npxProbe: NonNullable<ProbeOptions['npxProbeOverride']>,
  timeoutMs: number,
): Promise<AgentDetection> {
  const display = displayFor(agentId)
  let resolved: string
  try {
    resolved = agentRegistry.resolve(agentId)
  } catch {
    return build(display, 'not-installed', null, false)
  }

  const parsed = parseSpawnCommand(resolved)

  if (parsed.npxBased) {
    const pkg = parseNpxPackageName(resolved)
    const cached = pkg ? await npxProbe(pkg).catch(() => false) : false
    return build(display, cached ? 'installed' : 'npx-available', null, true)
  }

  // For binary-based agents, resolve to a stable absolute path so spawning
  // isn't subject to the Electron main process's stripped PATH (or fnm's
  // per-shell symlinks). When resolution fails we still probe the raw
  // command and let the OS surface the miss.
  const bin = (await resolveStableBinary(parsed.bin)) ?? parsed.bin
  const result = await binProbe(bin, timeoutMs).catch(() => ({
    found: false,
    version: null,
  }))
  return build(
    display,
    result.found ? 'installed' : 'not-installed',
    result.version,
    false,
  )
}

function build(
  display: ReturnType<typeof displayFor>,
  installState: AgentInstallState,
  version: string | null,
  npxBased: boolean,
): AgentDetection {
  return {
    agentId: display.agentId,
    displayName: display.label,
    installUrl: display.installUrl,
    installState,
    version,
    npxBased,
  }
}

async function probeBinary(
  bin: string,
  timeoutMs: number,
): Promise<{ found: boolean; version: string | null }> {
  // `command -v` is a shell builtin, so it runs under `sh -c`. The binary
  // probe afterwards spawns the real command with stdin pinned closed.
  const lookup = await runCommand(
    'sh',
    ['-c', `command -v ${bin}`],
    timeoutMs,
  ).catch(() => null)
  const found = !!(lookup && lookup.code === 0 && lookup.stdout.trim())
  if (!found) return { found: false, version: null }

  const versionResult = await runCommand(bin, ['--version'], timeoutMs).catch(
    () => null,
  )
  if (!versionResult || versionResult.code !== 0) {
    return { found: true, version: null }
  }
  const firstLine = versionResult.stdout.trim().split('\n')[0] ?? ''
  return { found: true, version: firstLine.length > 0 ? firstLine : null }
}

interface CommandResult {
  code: number
  stdout: string
  stderr: string
}

function runCommand(
  cmd: string,
  args: string[],
  timeoutMs: number,
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    let stdout = ''
    let stderr = ''
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] })

    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`Probe timed out after ${timeoutMs}ms`))
    }, timeoutMs)

    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString()
    })
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    child.once('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
    child.once('close', (code) => {
      clearTimeout(timer)
      resolve({ code: code ?? 1, stdout, stderr })
    })
  })
}

interface ParsedSpawnCommand {
  npxBased: boolean
  bin: string
}

function parseSpawnCommand(command: string): ParsedSpawnCommand {
  const head = command.trim().split(/\s+/)[0] ?? ''
  return { npxBased: head === 'npx', bin: head }
}

function parseNpxPackageName(command: string): string | null {
  const tokens = command.trim().split(/\s+/)
  if (tokens[0] !== 'npx') return null
  // Skip flags like `-y`; the first non-flag token after `npx` is the package spec.
  const pkgIndex = tokens.findIndex(
    (token, idx) => idx > 0 && !token.startsWith('-'),
  )
  if (pkgIndex < 0) return null
  const raw = tokens[pkgIndex] ?? ''
  if (!raw) return null
  // Strip trailing `@<spec>` version pin. Scoped names start with `@` at
  // index 0, so we only care about an `@` *after* the first character.
  const lastAt = raw.lastIndexOf('@')
  if (lastAt > 0) return raw.slice(0, lastAt)
  return raw
}
