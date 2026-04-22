export const ARCHES = ['arm64', 'x64'] as const
export type Arch = (typeof ARCHES)[number]

export function parseArch(s: string): Arch {
  if (s === 'arm64' || s === 'x64') return s
  throw new Error(`invalid arch: ${s} (expected 'arm64' | 'x64')`)
}

// YYYY.MM.DD with an optional numeric `-N` suffix (e.g. `-1`).
export const CALVER_REGEX = /^\d{4}\.\d{2}\.\d{2}(-\d+)?$/

export function assertCalver(version: string): void {
  if (!CALVER_REGEX.test(version)) {
    throw new Error(
      `invalid CalVer: ${version} (expected YYYY.MM.DD[-N], e.g. 2026.04.22 or 2026.04.22-1)`,
    )
  }
}

export function todayCalver(suffix?: number): string {
  const now = new Date()
  const yyyy = now.getUTCFullYear()
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(now.getUTCDate()).padStart(2, '0')
  const base = `${yyyy}.${mm}.${dd}`
  return suffix == null ? base : `${base}-${suffix}`
}
