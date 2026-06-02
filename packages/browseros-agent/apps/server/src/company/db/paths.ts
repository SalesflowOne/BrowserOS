import { homedir } from 'node:os'
import { join } from 'node:path'

// `bun run dev` sets BROWSERCLAW_PROFILE=dev so local dev work
// (SQLite + acpx state + CDP discovery) stays out of the production
// app's data directory and the two installations can run side-by-side.
export function appDataDir(): string {
  const dirName =
    // biome-ignore lint/style/noProcessEnv: dev/prod profile signal set by scripts/dev-launch-electron.ts
    process.env.BROWSERCLAW_PROFILE === 'dev'
      ? '.browserclaw-dev'
      : '.browserclaw'
  return join(homedir(), dirName)
}
