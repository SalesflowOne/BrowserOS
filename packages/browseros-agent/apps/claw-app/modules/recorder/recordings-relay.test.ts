import { describe, expect, it } from 'bun:test'
import type { Tab } from '@browseros/claw-api'
import { createRecordingsRelay } from './recordings-relay'

const serverBaseUrl = 'http://127.0.0.1:9511'

interface FakeTimer {
  id: number
  at: number
  callback: () => void
}

function tab(overrides: Partial<Tab> = {}): Tab {
  return {
    tabId: 42,
    pageId: 7,
    targetId: 'target-7',
    sessionId: 'session-1',
    slug: 'claude-code',
    label: 'Claude Code',
    url: 'https://example.com',
    title: 'Example',
    status: 'active',
    firstActivityAt: 1,
    lastActivityAt: 2,
    lastToolName: 'click',
    toolCount: 1,
    recentTools: [],
    ...overrides,
  }
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
      tabId: string
      pageId: string
      targetId: string
      succeeded: boolean
    }> = []
    let serverUp = false
    const relay = createRecordingsRelay({
      resolveServerBaseUrl: async () => serverBaseUrl,
      fetch: async (input, init) => {
        const url = String(input)
        if (url.endsWith('/tabs')) {
          return Response.json({ items: [tab()] })
        }
        attempts.push({
          url,
          body: String(init?.body),
          batchId: requestHeader(init, 'X-Recording-Batch-Id'),
          contentType: requestHeader(init, 'content-type'),
          tabId: requestHeader(init, 'X-Recording-Tab-Id'),
          pageId: requestHeader(init, 'X-Recording-Page-Id'),
          targetId: requestHeader(init, 'X-Recording-Target-Id'),
          succeeded: serverUp,
        })
        if (!serverUp) throw new TypeError('connection refused')
        return Response.json({ accepted: 1 })
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
        ({ url }) =>
          url === `${serverBaseUrl}/api/v1/sessions/session-1/recording/events`,
      ),
    ).toBe(true)
    expect(
      attempts.every(
        ({ contentType }) => contentType === 'application/x-ndjson',
      ),
    ).toBe(true)
    expect(
      attempts.every(
        ({ tabId, pageId, targetId }) =>
          tabId === '42' && pageId === '7' && targetId === 'target-7',
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

  it('drops during the legacy TTL when canonical tab discovery is absent', async () => {
    const clock = createFakeClock()
    let canonicalAvailable = false
    let listAttempts = 0
    const postedBodies: string[] = []
    const relay = createRecordingsRelay({
      resolveServerBaseUrl: async () => serverBaseUrl,
      fetch: async (input, init) => {
        const url = String(input)
        if (url.endsWith('/tabs')) {
          listAttempts++
          return canonicalAvailable
            ? Response.json({ items: [tab({ tabId: 1 })] })
            : new Response('{}', { status: 404 })
        }
        postedBodies.push(String(init?.body))
        return Response.json({ accepted: 1 })
      },
      now: clock.now,
      setTimeout: clock.setTimeout,
      clearTimeout: clock.clearTimeout,
      warn: () => {},
    })

    await relay.post(1, 'legacy-detected')
    await relay.post(1, 'dropped-inside-ttl')
    expect(listAttempts).toBe(1)
    expect(postedBodies).toEqual([])
    expect(clock.pendingTimers()).toBe(0)

    canonicalAvailable = true
    await clock.advanceBy(10 * 60_000)
    await relay.post(1, 'after-ttl')
    expect(listAttempts).toBe(2)
    expect(postedBodies).toEqual(['after-ttl'])
  })

  it('heals tabs whose batches were dropped by a legacy interval', async () => {
    const clock = createFakeClock()
    const recoveredTabs: number[] = []
    let response: 'transient' | 'legacy' | 'success' = 'transient'
    let attempts = 0
    const relay = createRecordingsRelay({
      resolveServerBaseUrl: async () => serverBaseUrl,
      fetch: async (input) => {
        const url = String(input)
        attempts++
        if (response === 'transient') throw new TypeError('connection refused')
        if (response === 'legacy') return new Response('{}', { status: 404 })
        return url.endsWith('/tabs')
          ? Response.json({
              items: [tab({ tabId: 1 }), tab({ tabId: 2 }), tab({ tabId: 3 })],
            })
          : Response.json({ accepted: 1 })
      },
      now: clock.now,
      setTimeout: clock.setTimeout,
      clearTimeout: clock.clearTimeout,
      warn: () => {},
    })
    relay.onTabRecoveredAfterLoss((tabId) => recoveredTabs.push(tabId))

    await relay.post(1, 'queued-trigger')
    await relay.post(2, 'queued-cleared')
    response = 'legacy'
    await clock.advanceBy(5_000)
    const attemptsAfter404 = attempts
    await relay.post(3, 'dropped-inside-ttl')
    expect(attempts).toBe(attemptsAfter404)

    response = 'success'
    await clock.advanceBy(10 * 60_000)
    await relay.post(1, 'tab-1-recovers')
    await relay.post(2, 'tab-2-recovers')
    await relay.post(3, 'tab-3-recovers')
    expect(recoveredTabs).toEqual([1, 2, 3])
  })

  it('marks an evicted tab gapped and requests a resnapshot after recovery', async () => {
    const clock = createFakeClock()
    const recoveredTabs: number[] = []
    let serverUp = false
    const relay = createRecordingsRelay({
      resolveServerBaseUrl: async () => serverBaseUrl,
      fetch: async (input) => {
        const url = String(input)
        if (url.endsWith('/tabs')) {
          return Response.json({
            items: [tab({ tabId: 1 }), tab({ tabId: 2 })],
          })
        }
        if (!serverUp) throw new TypeError('connection refused')
        return Response.json({ accepted: 1 })
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

  it('drops an unassociated tab without retrying and heals on the next success', async () => {
    const clock = createFakeClock()
    const postedBodies: string[] = []
    const recoveredTabs: number[] = []
    let associated = false
    const relay = createRecordingsRelay({
      resolveServerBaseUrl: async () => serverBaseUrl,
      fetch: async (input, init) => {
        const url = String(input)
        if (url.endsWith('/tabs')) {
          return Response.json({
            items: [
              tab({
                tabId: 7,
                sessionId: associated ? 'session-1' : undefined,
              }),
            ],
          })
        }
        postedBodies.push(String(init?.body))
        return Response.json({ accepted: 1 })
      },
      now: clock.now,
      setTimeout: clock.setTimeout,
      clearTimeout: clock.clearTimeout,
      warn: () => {},
    })
    relay.onTabRecoveredAfterLoss((tabId) => recoveredTabs.push(tabId))

    await relay.post(7, 'terminal')
    expect(clock.pendingTimers()).toBe(0)

    associated = true
    await relay.post(7, 'next')
    expect(postedBodies).toEqual(['next'])
    expect(recoveredTabs).toEqual([7])
  })

  it('maps exact tab identity and resnapshots when its association changes', async () => {
    const posts: Array<{
      url: string
      tabId: string
      pageId: string
      targetId: string
    }> = []
    const recoveredTabs: number[] = []
    const associations = [
      tab(),
      tab({ sessionId: 'session-2', pageId: 8 }),
      tab({ sessionId: 'session-3', pageId: 9, targetId: 'target-9' }),
    ]
    let listIndex = 0
    const relay = createRecordingsRelay({
      resolveServerBaseUrl: async () => serverBaseUrl,
      fetch: async (input, init) => {
        const url = String(input)
        if (url.endsWith('/tabs')) {
          return Response.json({
            items: [
              tab({
                tabId: 41,
                sessionId: 'wrong-session',
                pageId: 6,
                targetId: 'wrong-target',
              }),
              associations[listIndex++],
            ],
          })
        }
        posts.push({
          url,
          tabId: requestHeader(init, 'X-Recording-Tab-Id'),
          pageId: requestHeader(init, 'X-Recording-Page-Id'),
          targetId: requestHeader(init, 'X-Recording-Target-Id'),
        })
        expect(init?.body).toBe(`batch-${listIndex}`)
        return Response.json({ accepted: 1 })
      },
    })
    relay.onTabRecoveredAfterLoss((tabId) => recoveredTabs.push(tabId))

    await relay.post(42, 'batch-1')
    await relay.post(42, 'batch-2')
    await relay.post(42, 'batch-3')

    expect(posts).toEqual([
      {
        url: `${serverBaseUrl}/api/v1/sessions/session-1/recording/events`,
        tabId: '42',
        pageId: '7',
        targetId: 'target-7',
      },
      {
        url: `${serverBaseUrl}/api/v1/sessions/session-2/recording/events`,
        tabId: '42',
        pageId: '8',
        targetId: 'target-7',
      },
      {
        url: `${serverBaseUrl}/api/v1/sessions/session-3/recording/events`,
        tabId: '42',
        pageId: '9',
        targetId: 'target-9',
      },
    ])
    expect(recoveredTabs).toEqual([42, 42])
  })

  it('treats a server-side association race as a gap and heals after rediscovery', async () => {
    const recoveredTabs: number[] = []
    let associationChanged = true
    const relay = createRecordingsRelay({
      resolveServerBaseUrl: async () => serverBaseUrl,
      fetch: async (input) => {
        const url = String(input)
        if (url.endsWith('/tabs')) return Response.json({ items: [tab()] })
        if (associationChanged) return new Response('{}', { status: 409 })
        return Response.json({ accepted: 1 })
      },
      warn: () => {},
    })
    relay.onTabRecoveredAfterLoss((tabId) => recoveredTabs.push(tabId))

    await relay.post(42, 'stale-association')
    expect(recoveredTabs).toEqual([])

    associationChanged = false
    await relay.post(42, 'fresh-association')
    expect(recoveredTabs).toEqual([42])
  })

  it('warns again when a new outage begins after delivery recovered', async () => {
    const clock = createFakeClock()
    const warnings: unknown[][] = []
    let serverUp = false
    const relay = createRecordingsRelay({
      resolveServerBaseUrl: async () => serverBaseUrl,
      fetch: async (input) => {
        const url = String(input)
        if (url.endsWith('/tabs')) {
          return Response.json({ items: [tab({ tabId: 3 })] })
        }
        if (!serverUp) throw new TypeError('connection refused')
        return Response.json({ accepted: 1 })
      },
      now: clock.now,
      setTimeout: clock.setTimeout,
      clearTimeout: clock.clearTimeout,
      warn: (...args) => warnings.push(args),
    })

    await relay.post(3, 'first-outage')
    serverUp = true
    await clock.advanceBy(5_000)
    serverUp = false
    await relay.post(3, 'second-outage')

    expect(
      warnings.filter(
        ([message]) => message === '[browseros-claw replay] events POST failed',
      ),
    ).toHaveLength(2)
  })
})
