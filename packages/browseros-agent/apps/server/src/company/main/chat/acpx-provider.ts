import { homedir } from 'node:os'
import path from 'node:path'
import {
  type AcpxMcpServerConfig,
  type AcpxProvider,
  type AcpxProviderSettings,
  createAcpxProvider,
} from 'acpx-ai-provider'
import { appDataDir } from '../../db/paths.js'
import type { Thread } from '../../db/schema/threads.sql.js'
import type { PermissionMode } from '../../shared/permission.js'
import { resolveStableBinary } from './binary-resolver.js'
import type { ProtocolEvent } from './events.types.js'
import { buildPermissionCallback } from './permission-callback.js'
import type { ChatTuple } from './tuple.js'

export const ACPX_STATE_DIR = path.join(appDataDir(), 'acpx-state')

// Resolved once at boot. acpx's default registry shells out to
// `npx` for claude/codex, which under fnm/nvm/volta resolves to a path
// inside a per-shell-instance directory that gets cleaned up when its
// parent shell exits. We chase the symlink to a stable absolute path
// and rewrite the registry commands to use that instead. Bunx is the
// fallback — it's a Homebrew-managed binary at a non-moving path.
//
// Populated by `primeAcpxOverrides()` from main/index.ts at boot, so
// `buildBaseRegistryOverrides()` stays synchronous on the hot path
// (every ChatSession build).
let cachedOverrides: Record<string, string> | null = null

const FALLBACK_OVERRIDES: Record<string, string> = {
  // Hermes ships as `hermes acp`; the binary itself is on PATH.
  hermes: 'hermes acp',
}

/**
 * Resolves npx/bunx once at boot and caches the rewritten launcher
 * commands for claude + codex. Must be awaited in main() before the
 * Hono server binds, so the first chat send finds the cache primed.
 *
 * Idempotent: subsequent calls are a no-op once the cache exists.
 */
export async function primeAcpxOverrides(): Promise<void> {
  if (cachedOverrides) return
  const overrides: Record<string, string> = { ...FALLBACK_OVERRIDES }
  // Prefer npx (per the reference repo's choice). Falls back to bunx only
  // when npx isn't on PATH at all.
  const npx = await resolveStableBinary('npx')
  const bunx = npx ? null : await resolveStableBinary('bunx')
  const launcher = npx
    ? { bin: npx, flag: '-y' }
    : bunx
      ? { bin: bunx, flag: '' }
      : null
  if (launcher) {
    const prefix = launcher.flag
      ? `${launcher.bin} ${launcher.flag} `
      : `${launcher.bin} `
    overrides.claude = `${prefix}@agentclientprotocol/claude-agent-acp@^0.31.0`
    overrides.codex = `${prefix}@zed-industries/codex-acp@^0.12.0`
  }
  cachedOverrides = overrides
}

function buildBaseRegistryOverrides(): Record<string, string> {
  return cachedOverrides ?? FALLBACK_OVERRIDES
}

export type AcpxProviderFactory = (
  settings: AcpxProviderSettings,
) => AcpxProvider

interface BuildOptions {
  /** Effective tuple — agent / model / cwd / effort for this session. */
  tuple: ChatTuple
  thread: Thread
  mcpServers?: AcpxMcpServerConfig[]
  providerFactory?: AcpxProviderFactory
  /**
   * Override the default sessionKey of `thread.id`. ChatSession passes
   * `tupleKey(tuple)` here so each (agentKind, model, workspace, effort)
   * combination gets its own on-disk acpx record. When the user switches
   * back to a prior tuple later, the persistent record can resume that
   * agent's own session memory.
   */
  sessionKeyOverride?: string
  /**
   * Getter for the thread's current permission mode. Read fresh on
   * every callback invocation so mid-session picker changes take
   * effect on the next turn without rebuilding the provider.
   */
  getPermissionMode: () => PermissionMode
  /**
   * Bridge from buildPermissionCallback into the thread's EventSink
   * so permission.request / permission.resolved events flow alongside
   * the rest of the turn's events. ChatSession passes its own emit.
   */
  writeProtocolEvent: (event: ProtocolEvent) => Promise<void>
  /**
   * Callback-time lookup for the active turn's requestId — paired
   * with the permission.request payload so the renderer keeps the
   * card grouped with its turn during transcript replay.
   */
  getActiveTurnRequestId: () => string | null
}

/** Builds the acpx provider with app-owned thread/session settings. */
export function buildAcpxProvider(opts: BuildOptions): AcpxProvider {
  const providerFactory = opts.providerFactory ?? createAcpxProvider
  return providerFactory({
    agent: opts.tuple.agentKind,
    cwd: opts.tuple.workspacePath ?? homedir(),
    sessionKey: opts.sessionKeyOverride ?? opts.thread.id,
    sessionMode: 'persistent',
    stateDir: ACPX_STATE_DIR,
    // resumeSessionId intentionally omitted: the (sessionKey, agent, cwd)
    // tuple is already enough for acpx's file-based state store to resume
    // an existing record, and the legacy thread.acpxSessionId column was
    // never written. Passing a stale id from one agent to another binary
    // would actively break things.
    agentRegistryOverrides: buildBaseRegistryOverrides(),
    // Acpx's built-in permissionMode is now a fallback for when
    // onPermissionRequest throws; the picker is the source of truth and
    // the callback always either auto-resolves or escalates.
    // 'approve-reads' is the safest fallback: it matches our default
    // 'auto-approve-reads' mode rather than the wide-open 'approve-all'.
    permissionMode: 'approve-reads',
    nonInteractivePermissions: 'deny',
    onPermissionRequest: buildPermissionCallback({
      threadId: opts.thread.id,
      getPermissionMode: opts.getPermissionMode,
      emit: opts.writeProtocolEvent,
      getActiveTurnRequestId: opts.getActiveTurnRequestId,
    }),
    mcpServers: opts.mcpServers,
  })
}
