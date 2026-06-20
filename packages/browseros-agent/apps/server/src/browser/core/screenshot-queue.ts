import type { ProtocolApi } from '@browseros/cdp-protocol/protocol-api'

const annotatedCaptureQueues = new WeakMap<ProtocolApi, Promise<void>>()

/** Serializes annotated captures because page overlay DOM is visible to all screenshots on that page. */
export async function runExclusiveAnnotatedCapture<T>(
  pageSession: ProtocolApi,
  task: () => Promise<T>,
): Promise<T> {
  const previous = annotatedCaptureQueues.get(pageSession) ?? Promise.resolve()
  let releaseCurrent = () => {}
  const current = new Promise<void>((resolve) => {
    releaseCurrent = resolve
  })
  const tail = previous.catch(() => {}).then(() => current)
  annotatedCaptureQueues.set(pageSession, tail)

  await previous.catch(() => {})
  try {
    return await task()
  } finally {
    releaseCurrent()
    if (annotatedCaptureQueues.get(pageSession) === tail) {
      annotatedCaptureQueues.delete(pageSession)
    }
  }
}
