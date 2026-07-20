import { createAuthClient } from 'better-auth/react'
import { env } from '../env'
import { authRedirectPathStorage } from '../onboarding/onboardingStorage'
import { isOwebProduct } from '../product-config'
import { buildOwebAuthUrl } from '../oweb-auth'
import {
  getOwebRedirectUri,
  signOutOweb,
  useOwebSession,
} from './oweb-session'

const {
  signIn: browserosSignIn,
  signOut: browserosSignOut,
  useSession: browserosUseSession,
} = createAuthClient({
  baseURL: env.VITE_PUBLIC_BROWSEROS_API,
})

export async function signInWithOweb(options?: { callbackURL?: string }) {
  if (options?.callbackURL) {
    await authRedirectPathStorage.setValue(options.callbackURL)
  }
  const redirectUri = getOwebRedirectUri()
  const authUrl = buildOwebAuthUrl(redirectUri)
  window.location.assign(authUrl)
}

export const signIn = {
  social: async (options: {
    provider: string
    callbackURL?: string
  }) => {
    if (isOwebProduct()) {
      await signInWithOweb({ callbackURL: options.callbackURL })
      return
    }
    return browserosSignIn.social(options)
  },
}

export async function signOut() {
  if (isOwebProduct()) {
    await signOutOweb()
    return
  }
  return browserosSignOut()
}

export function useSession() {
  const oweb = useOwebSession()
  const browseros = browserosUseSession()
  return isOwebProduct() ? oweb : browseros
}
