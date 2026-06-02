import { useCallback, useEffect, useState } from 'react'

// Recent-workspaces MRU stored in window.localStorage. The plan calls
// out a settings-KV option as well; localStorage is fine for v1 since
// this is convenience data the user can rebuild trivially by re-
// picking a folder. Moving to a typed settings row is a follow-up.
const STORAGE_KEY = 'composer.recentWorkspaces.v1'
const MAX_RECENT = 6

function readRecent(): string[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((v): v is string => typeof v === 'string')
      .slice(0, MAX_RECENT)
  } catch {
    return []
  }
}

function writeRecent(values: string[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(values))
  } catch {
    // localStorage quota / private mode — fail silently. The user
    // can always re-pick.
  }
}

export interface UseRecentWorkspaces {
  recent: string[]
  addRecent: (path: string) => void
}

export function useRecentWorkspaces(): UseRecentWorkspaces {
  const [recent, setRecent] = useState<string[]>(() => readRecent())

  useEffect(() => {
    // Hydrate from storage on mount (covers cases where a write
    // happens in another window or before this hook mounted).
    setRecent(readRecent())
  }, [])

  const addRecent = useCallback((path: string) => {
    setRecent((current) => {
      const next = [path, ...current.filter((p) => p !== path)].slice(
        0,
        MAX_RECENT,
      )
      writeRecent(next)
      return next
    })
  }, [])

  return { recent, addRecent }
}
