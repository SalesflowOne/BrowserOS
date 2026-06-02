import type { AppType } from '@browseros/server/company'
import { hc } from 'hono/client'

export function createApiClient(baseUrl: string) {
  return hc<AppType>(baseUrl)
}
