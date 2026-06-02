import { glob } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

// Default `npx` cache lives under `~/.npm/_npx/<hash>/node_modules/<pkg>`.
// Overridable for tests via env so the probe can point at a fixture tree.
function npxCacheRoot(): string {
  const override =
    // biome-ignore lint/style/noProcessEnv: ad-hoc test seam — not app config
    process.env.BROWSERCLAW_NPX_CACHE_ROOT
  return override ?? join(homedir(), '.npm', '_npx')
}

/**
 * Reports whether `npx` has previously fetched `<packageName>` and would
 * therefore run it without a network round-trip. Used by agent detection
 * to mark npx-invoked agents as `npx-available` even when the underlying
 * binary isn't on the user's PATH.
 *
 * Returns `false` on any I/O error (e.g. the cache root doesn't exist
 * yet) — those are indistinguishable from a cache miss for our purposes.
 */
export async function probeNpxCache(packageName: string): Promise<boolean> {
  if (!packageName) return false
  const root = npxCacheRoot()
  const pattern = `*/node_modules/${packageName}/package.json`
  try {
    for await (const _entry of glob(pattern, { cwd: root })) {
      return true
    }
  } catch {
    // Cache root missing / unreadable → npx will fetch on first use anyway.
  }
  return false
}
