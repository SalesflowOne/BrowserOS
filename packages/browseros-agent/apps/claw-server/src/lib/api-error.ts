import type { ApiError } from '@browseros/claw-api'

export function canonicalApiError(
  code: string,
  message: string,
  requestId?: string,
): ApiError {
  return requestId === undefined
    ? { code, message }
    : { code, message, requestId }
}
