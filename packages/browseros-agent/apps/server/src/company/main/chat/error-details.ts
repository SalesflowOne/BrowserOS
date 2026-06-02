// Normalises arbitrary thrown values into a stable shape we persist
// on `error` events and surface to the renderer toast.

export interface ErrorDetails {
  code: string
  message: string
  retryable: boolean
  // Extra free-form context. We prefer the cause chain's message when
  // present, falling back to the stack (sans the first line, which
  // already contains code + message). Rendered under the primary
  // message in the structured error block.
  details?: string
}

const RETRYABLE_CODES = new Set([
  'ETIMEDOUT',
  'ECONNRESET',
  'EAI_AGAIN',
  'ENOTFOUND',
])

function deriveDetails(err: Error): string | undefined {
  const cause = (err as { cause?: unknown }).cause
  if (cause instanceof Error && cause.message) {
    return cause.message
  }
  if (typeof cause === 'string' && cause.length > 0) {
    return cause
  }
  if (typeof err.stack === 'string') {
    const lines = err.stack.split('\n')
    const trimmed = lines.slice(1).join('\n').trim()
    return trimmed.length > 0 ? trimmed : undefined
  }
  return undefined
}

export function extractErrorDetails(err: unknown): ErrorDetails {
  if (err instanceof Error) {
    const code =
      'code' in err && typeof (err as { code: unknown }).code === 'string'
        ? (err as { code: string }).code
        : err.name
    return {
      code,
      message: err.message || 'Unknown error',
      retryable: RETRYABLE_CODES.has(code),
      details: deriveDetails(err),
    }
  }
  return {
    code: 'unknown',
    message: typeof err === 'string' ? err : 'Unknown error',
    retryable: false,
  }
}
