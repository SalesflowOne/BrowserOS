import { exec } from 'node:child_process'
import { existsSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'

const execAsync = promisify(exec)

// Resolves a binary to an absolute path that remains valid for the
// lifetime of the Electron main process. Naive `which <name>` under a
// node version manager (fnm) returns a per-shell-instance symlink that
// disappears when its parent shell exits — by the time we spawn, the
// path is gone. We detect that case and rewrite to the underlying
// stable install path (e.g. fnm's installation/bin).
//
// Side effect: prepends the resolved bin directory to process.env.PATH.
// Many resolved binaries (npx, bunx) are node scripts with
// `#!/usr/bin/env node` shebangs, so `node` itself must be discoverable
// via PATH when the OS executes them — even when we spawn with an
// absolute path. Augmenting PATH ensures shebang interpreters resolve
// without forcing every caller to spawn via `node /path/to/script.js`.
export async function resolveStableBinary(
  name: string,
): Promise<string | null> {
  const raw = await whichInLoginShell(name)
  if (!raw) return null
  const stable = stabilise(raw)
  prependToPath(dirname(stable))
  return stable
}

const augmentedPathSegments = new Set<string>()

function prependToPath(segment: string): void {
  if (augmentedPathSegments.has(segment)) return
  augmentedPathSegments.add(segment)
  // biome-ignore lint/style/noProcessEnv: PATH is an OS-level inherited env, not app config — there's no Node API for it
  const current = process.env.PATH ?? ''
  if (current.split(':').includes(segment)) return
  // biome-ignore lint/style/noProcessEnv: same — PATH must be mutated for spawned children to inherit
  process.env.PATH = current ? `${segment}:${current}` : segment
}

const FNM_TRANSIENT = '/fnm_multishells/'

function stabilise(rawPath: string): string {
  // Already stable — no fnm shenanigans in the path.
  if (!rawPath.includes(FNM_TRANSIENT)) return rawPath
  // The shell-wrapper path under fnm_multishells is itself a symlink
  // into the installation bin dir. realpath follows recursively, which
  // would chase past the wrapper into the underlying script (and break
  // executability since the script depends on its containing wrapper).
  // Instead, find the matching `installation/bin/<basename>` directly.
  const installationBin = findInstallationBin(rawPath)
  if (installationBin) return installationBin
  // Fallback: chase symlinks one hop at a time so we get the closest
  // stable parent. node's realpathSync is recursive; do it manually.
  try {
    return realpathSync.native(rawPath)
  } catch {
    return rawPath
  }
}

function findInstallationBin(rawPath: string): string | null {
  // fnm path shape: <state>/fnm_multishells/<id>/bin/<name>
  // Stable target:  <data>/fnm/node-versions/<v>/installation/bin/<name>
  // The wrapper in the multishell dir is a symlink to the installation
  // bin entry; we want that intermediate path (preserves the wrapper's
  // shim semantics) without the transient parent.
  const name = rawPath.split('/').pop()
  if (!name) return null
  // Resolve the symlink ONE level — this lands on the installation/bin
  // file (which is itself a symlink to the underlying npm script, but
  // we don't follow that next hop).
  try {
    // Walk fnm versions dir and pick the one whose installation/bin/<name>
    // resolves to the same target as the transient path.
    const versionsDir = join(homedir(), '.local/share/fnm/node-versions')
    if (!existsSync(versionsDir)) return null
    const link = realpathSync.native(rawPath)
    // The realpath ends with e.g. lib/node_modules/npm/bin/npx-cli.js.
    // The matching wrapper is `installation/bin/npx` in the same version
    // root. Climb until we find an `installation` segment.
    const segments = link.split('/')
    const installationIdx = segments.lastIndexOf('installation')
    if (installationIdx < 0) return null
    const installRoot = segments.slice(0, installationIdx + 1).join('/')
    const candidate = join(installRoot, 'bin', name)
    return existsSync(candidate) ? candidate : null
  } catch {
    return null
  }
}

async function whichInLoginShell(name: string): Promise<string | null> {
  // biome-ignore lint/style/noProcessEnv: SHELL is an OS-level inherited env, not app config — there's no Node API for it
  const shell = process.env.SHELL ?? '/bin/zsh'
  // Login interactive shells source ~/.zprofile/~/.zshrc/plugins to
  // get the user's real PATH — that can take hundreds of ms to multiple
  // seconds depending on shell config. Must stay async so it doesn't
  // freeze Electron's main process event loop — sync execution
  // beachballs every renderer the main process owns.
  try {
    const { stdout } = await execAsync(
      `${shell} -lic 'command -v ${name}' 2>/dev/null`,
      { encoding: 'utf8', timeout: 3_000 },
    )
    const trimmed = stdout.trim().split('\n').pop()?.trim()
    return trimmed && trimmed.length > 0 ? trimmed : null
  } catch {
    return null
  }
}
