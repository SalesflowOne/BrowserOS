import type { Context, MiddlewareHandler } from 'hono'

export type RequestContextEnv = {
  Variables: {
    requestId: string
  }
}

export const requestIdMiddleware: MiddlewareHandler<RequestContextEnv> = async (
  c,
  next,
) => {
  const requestId = crypto.randomUUID()
  c.set('requestId', requestId)
  await next()
  c.header('x-request-id', requestId)
}

export function requestIdFor(c: Context<RequestContextEnv>): string {
  return c.get('requestId')
}
