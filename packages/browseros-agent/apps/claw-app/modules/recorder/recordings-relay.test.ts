import { describe, expect, it } from 'bun:test'
import { createRecordingsRelay } from './recordings-relay'

const serverBaseUrl = 'http://127.0.0.1:9511'

interface FakeTimer {
  id: number
  at: number
  callback: () => void
}

function createFakeClock() {
  let now = 0
  let nextTimerId = 1
  const timers: FakeTimer[] = []

  return {
    now: () => now,
    setTimeout(callback: () => void, delayMs: number) {
      const timer = { id: nextTimerId++, at: now + delayMs, callback }
      timers.push(timer)
      return timer.id as unknown as ReturnType<typeof globalThis.setTimeout>
    },
    clearTimeout(handle: ReturnType<typeof globalThis.setTimeout>) {
      const index = timers.findIndex((timer) => timer.id === Number(handle))
      if (index !== -1) timers.splice(index, 1)
    },
    async advanceBy(delayMs: number) {
      now += delayMs
      while (true) {
        timers.sort((a, b) => a.at - b.at)
        const timer = timers[0]
        if (!timer || timer.at > now) return
        timers.shift()
        await timer.callback()
      }
    },
    pendingTimers: () => timers.length,
  }
}

function requestHeader(init: RequestInit | undefined, name: string): string {
  return new Headers(init?.headers).get(name) ?? ''
}

describe('createRecordingsRelay', () => {
  it('queues batches while the server is down, then delivers them in order after recovery with stable ids', async () => {
    const clock = createFakeClock()
    const attempts: Array<{
      url: string
      body: string
      batchId: string
      contentType: string
      succeeded: boolean
    }> = []
    let serverUp = false
    const relay = createRecordingsRelay({
      resolveServerBaseUrl: async () => serverBaseUrl,
      fetch: async (input, init) => {
        attempts.push({
          url: String(input),
          body: String(init?.body),
          batchId: requestHeader(init, 'X-Recording-Batch-Id'),
          contentType: requestHeader(init, 'content-type'),
          succeeded: serverUp,
        })
        if (!serverUp) throw new TypeError('connection refused')
        return Response.json({ ok: true, accepted: 1 })
      },
      now: clock.now,
      setTimeout: clock.setTimeout,
      clearTimeout: clock.clearTimeout,
      warn: () => {},
    })

    await relay.post(42, 'first')
    await relay.post(42, 'second')

    expect(
      attempts.every(
        ({ url }) => url === `${serverBaseUrl}/recordings/tabs/42/events`,
      ),
    ).toBe(true)
    expect(
      attempts.every(
        ({ contentType }) => contentType === 'application/x-ndjson',
      ),
    ).toBe(true)
    expect(attempts.every(({ body }) => body === 'first')).toBe(true)
    expect(clock.pendingTimers()).toBe(1)

    serverUp = true
    await clock.advanceBy(5_000)

    const successful = attempts.filter(({ succeeded }) => succeeded)
    expect(successful.map(({ body }) => body)).toEqual(['first', 'second'])
    const firstIds = attempts
      .filter(({ body }) => body === 'first')
      .map(({ batchId }) => batchId)
    expect(new Set(firstIds).size).toBe(1)
    expect(firstIds[0]).not.toBe('')
    expect(successful[1]?.batchId).not.toBe('')
    expect(successful[1]?.batchId).not.toBe(firstIds[0])
    expect(clock.pendingTimers()).toBe(0)
  })

  it('drops during the legacy TTL after a real 404, then attempts again', async () => {
    const clock = createFakeClock()
    const bodies: string[] = []
    let status = 404
    const relay = createRecordingsRelay({
      resolveServerBaseUrl: async () => serverBaseUrl,
      fetch: async (_input, init) => {
        bodies.push(String(init?.body))
        return Response.json(
          status === 404 ? { ok: false } : { ok: true, accepted: 1 },
          { status },
        )
      },
      now: clock.now,
      setTimeout: clock.setTimeout,
      clearTimeout: clock.clearTimeout,
      warn: () => {},
    })

    await relay.post(1, 'legacy-detected')
    await relay.post(1, 'dropped-inside-ttl')
    expect(bodies).toEqual(['legacy-detected'])
    expect(clock.pendingTimers()).toBe(0)

    status = 200
    await clock.advanceBy(10 * 60_000)
    await relay.post(1, 'after-ttl')
    expect(bodies).toEqual(['legacy-detected', 'after-ttl'])
  })

  it('marks an evicted tab gapped and requests a resnapshot after recovery', async () => {
    const clock = createFakeClock()
    const recoveredTabs: number[] = []
    let serverUp = false
    const relay = createRecordingsRelay({
      resolveServerBaseUrl: async () => serverBaseUrl,
      fetch: async () => {
        if (!serverUp) throw new TypeError('connection refused')
        return Response.json({ ok: true, accepted: 1 })
      },
      now: clock.now,
      setTimeout: clock.setTimeout,
      clearTimeout: clock.clearTimeout,
      warn: () => {},
    })
    relay.onTabRecoveredAfterLoss((tabId) => recoveredTabs.push(tabId))

    await relay.post(1, 'a'.repeat(6 * 1024 * 1024))
    await relay.post(2, 'b'.repeat(6 * 1024 * 1024))

    serverUp = true
    await clock.advanceBy(5_000)
    expect(recoveredTabs).toEqual([])

    await relay.post(1, 'fresh-checkpoint-request')
    expect(recoveredTabs).toEqual([1])
  })

  it('drops an unknown-tab response without retrying and heals on the next success', async () => {
    const clock = createFakeClock()
    const bodies: string[] = []
    const recoveredTabs: number[] = []
    const relay = createRecordingsRelay({
      resolveServerBaseUrl: async () => serverBaseUrl,
      fetch: async (_input, init) => {
        bodies.push(String(init?.body))
        return bodies.length === 1
          ? Response.json({ ok: false, reason: 'unknown tab' })
          : Response.json({ ok: true, accepted: 1 })
      },
      now: clock.now,
      setTimeout: clock.setTimeout,
      clearTimeout: clock.clearTimeout,
      warn: () => {},
    })
    relay.onTabRecoveredAfterLoss((tabId) => recoveredTabs.push(tabId))

    await relay.post(7, 'terminal')
    expect(clock.pendingTimers()).toBe(0)

    await relay.post(7, 'next')
    expect(bodies).toEqual(['terminal', 'next'])
    expect(recoveredTabs).toEqual([7])
  })
})
