import { useCallback, useEffect, useState } from 'react'
import type { Session, User } from 'better-auth/types'
import {
  applyOwebSession,
  clearStoredSession,
  getStoredSession,
  parseAuthRedirectUrl,
  refreshOwebSessionIfNeeded,
  type OWebAuthSession,
} from '../oweb-auth'
import { sessionStorage, type SessionInfo } from './sessionStorage'

export type OwebAuthSessionView = {
  session: Session
  user: User
}

function toAuthView(oweb: OWebAuthSession): OwebAuthSessionView {
  return {
    session: {
      id: 'oweb',
      userId: oweb.userId,
      expiresAt: oweb.expiresAt
        ? new Date(oweb.expiresAt * 1000)
        : new Date(Date.now() + 60 * 60 * 1000),
      createdAt: new Date(oweb.updatedAt),
      updatedAt: new Date(oweb.updatedAt),
      token: oweb.accessToken,
    },
    user: {
      id: oweb.userId,
      email: oweb.email ?? '',
      name: oweb.email ?? 'OWeb user',
      emailVerified: true,
      createdAt: new Date(oweb.updatedAt),
      updatedAt: new Date(oweb.updatedAt),
      image: null,
    },
  }
}

async function syncSessionStorage(oweb: OWebAuthSession | null): Promise<void> {
  if (!oweb) {
    await sessionStorage.setValue({})
    return
  }
  const view = toAuthView(oweb)
  await sessionStorage.setValue({
    session: view.session,
    user: view.user,
  } satisfies SessionInfo)
}

export async function completeOwebAuthFromUrl(url: string): Promise<boolean> {
  try {
    const tokens = parseAuthRedirectUrl(url)
    const stored = await applyOwebSession(tokens)
    await syncSessionStorage(stored)
    return true
  } catch {
    return false
  }
}

export async function consumeOwebAuthRedirect(): Promise<boolean> {
  const { href, hash, search } = window.location
  const tokenFragment = hash.startsWith('#') ? hash.slice(1) : hash
  if (!tokenFragment.includes('access_token') && !search.includes('access_token')) {
    return false
  }

  const handled = await completeOwebAuthFromUrl(href)
  if (handled) {
    window.history.replaceState(null, '', `${window.location.pathname}#/home`)
  }
  return handled
}

export function getOwebRedirectUri(): string {
  return chrome.runtime.getURL('app.html')
}

export async function signOutOweb(): Promise<void> {
  clearStoredSession()
  await sessionStorage.setValue({})
}

export function useOwebSession() {
  const [data, setData] = useState<OwebAuthSessionView | null>(null)
  const [isPending, setIsPending] = useState(true)

  const refresh = useCallback(async () => {
    const stored = await refreshOwebSessionIfNeeded()
    await syncSessionStorage(stored)
    setData(stored ? toAuthView(stored) : null)
    setIsPending(false)
  }, [])

  useEffect(() => {
    void refresh()
    const onStorage = (event: StorageEvent) => {
      if (event.key === 'oweb_browser_session_v1') {
        void refresh()
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [refresh])

  return { data, isPending, refresh }
}

export function getOwebAccessToken(): string | null {
  return getStoredSession()?.accessToken ?? null
}
