import type { FC, PropsWithChildren } from 'react'
import { useEffect } from 'react'
import { identify, resetIdentity } from '@/lib/analytics/identify'
import { isOwebProduct } from '@/lib/product-config'
import { useSession } from './auth-client'
import { consumeOwebAuthRedirect } from './oweb-session'
import { useSessionInfo } from './sessionStorage'

export const AuthProvider: FC<PropsWithChildren> = ({ children }) => {
  const { data, isPending } = useSession()
  const { updateSessionInfo } = useSessionInfo()

  useEffect(() => {
    if (!isOwebProduct()) return
    void consumeOwebAuthRedirect()
  }, [])

  // biome-ignore lint/correctness/useExhaustiveDependencies: only re-run when data changes
  useEffect(() => {
    if (!isPending) {
      updateSessionInfo({
        session: data?.session,
        user: data?.user,
      })

      if (data?.user?.id) {
        identify({
          id: data.user.id,
          email: data.user.email,
          name: data.user.name || undefined,
        })
      } else {
        resetIdentity()
      }
    }
  }, [data, isPending])

  return <>{children}</>
}
