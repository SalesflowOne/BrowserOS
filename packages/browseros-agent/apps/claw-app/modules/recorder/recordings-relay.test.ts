import { describe, expect, it } from 'bun:test'
import type { Tab } from '@browseros/claw-api'
import { createRecordingsRelay } from './recordings-relay'

const serverBaseUrl = 'http://127.0.0.1:9511'

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

describe('createRecordingsRelay', () => {
  it('maps the sender tab directly and posts to its canonical session path', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const relay = createRecordingsRelay({
      resolveServerBaseUrl: async () => serverBaseUrl,
      fetch: async (input, init) => {
        const url = String(input)
        requests.push({ url, init })
        return url.endsWith('/tabs')
          ? Response.json({
              items: [
                tab({
                  tabId: 41,
                  sessionId: 'wrong-session',
                  pageId: 6,
                  targetId: 'wrong-target',
                }),
                tab(),
              ],
            })
          : Response.json({ ok: true, accepted: 1 })
      },
    })

    await relay.post(42, '{"ts":1,"type":3,"data":{}}')

    expect(requests.map(({ url }) => url)).toEqual([
      `${serverBaseUrl}/api/v1/tabs`,
      `${serverBaseUrl}/api/v1/sessions/session-1/recording/events`,
    ])
    expect(requests[1].init).toMatchObject({
      method: 'POST',
      headers: { 'content-type': 'application/x-ndjson' },
      body: '{"ts":1,"type":3,"data":{}}',
      credentials: 'omit',
    })
  })

  it('revalidates session, page, and target associations before each batch', async () => {
    const posts: string[] = []
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
          return Response.json({ items: [associations[listIndex++]] })
        }
        posts.push(url)
        expect(init?.body).toBe(`batch-${listIndex}`)
        return Response.json({ accepted: 1 })
      },
    })

    await relay.post(42, 'batch-1')
    await relay.post(42, 'batch-2')
    await relay.post(42, 'batch-3')

    expect(posts).toEqual([
      `${serverBaseUrl}/api/v1/sessions/session-1/recording/events`,
      `${serverBaseUrl}/api/v1/sessions/session-2/recording/events`,
      `${serverBaseUrl}/api/v1/sessions/session-3/recording/events`,
    ])
  })

  it('drops batches when the sender tab has no live session association', async () => {
    const requests: string[] = []
    const relay = createRecordingsRelay({
      resolveServerBaseUrl: async () => serverBaseUrl,
      fetch: async (input) => {
        requests.push(String(input))
        return Response.json({ items: [tab({ sessionId: undefined })] })
      },
    })

    await relay.post(42, 'batch')

    expect(requests).toEqual([`${serverBaseUrl}/api/v1/tabs`])
  })

  it('drops batches quietly while an unhealthy probe is cached', async () => {
    const requests: string[] = []
    let now = 0
    const warnings: unknown[][] = []
    const relay = createRecordingsRelay({
      resolveServerBaseUrl: async () => serverBaseUrl,
      fetch: async (input) => {
        requests.push(String(input))
        return new Response('{}', { status: 404 })
      },
      now: () => now,
      warn: (...args) => warnings.push(args),
    })

    await relay.post(1, 'first')
    await relay.post(1, 'second')
    expect(requests).toEqual([`${serverBaseUrl}/api/v1/tabs`])
    expect(warnings).toEqual([])

    now = 60_000
    await relay.post(1, 'third')
    expect(requests).toEqual([
      `${serverBaseUrl}/api/v1/tabs`,
      `${serverBaseUrl}/api/v1/tabs`,
    ])
  })

  it('re-probes on the next batch after a failed post', async () => {
    const requests: string[] = []
    const warnings: unknown[][] = []
    let now = 0
    const relay = createRecordingsRelay({
      resolveServerBaseUrl: async () => serverBaseUrl,
      fetch: async (input) => {
        const url = String(input)
        requests.push(url)
        return url.endsWith('/tabs')
          ? Response.json({ items: [tab({ tabId: 7 })] })
          : new Response('{}', { status: 503 })
      },
      now: () => now,
      warn: (...args) => warnings.push(args),
    })

    await relay.post(7, 'first')
    await relay.post(7, 'second')

    expect(requests).toEqual([
      `${serverBaseUrl}/api/v1/tabs`,
      `${serverBaseUrl}/api/v1/sessions/session-1/recording/events`,
      `${serverBaseUrl}/api/v1/tabs`,
      `${serverBaseUrl}/api/v1/sessions/session-1/recording/events`,
    ])
    expect(warnings).toHaveLength(1)

    now = 60_000
    await relay.post(7, 'third')
    expect(warnings).toHaveLength(2)
  })

  it('rearms the warning after event ingestion recovers', async () => {
    const warnings: unknown[][] = []
    let eventPosts = 0
    const relay = createRecordingsRelay({
      resolveServerBaseUrl: async () => serverBaseUrl,
      fetch: async (input) => {
        const url = String(input)
        if (url.endsWith('/tabs')) {
          return Response.json({ items: [tab({ tabId: 7 })] })
        }
        eventPosts++
        return eventPosts === 2
          ? Response.json({ ok: true, accepted: 1 })
          : new Response('{}', { status: 503 })
      },
      now: () => 0,
      warn: (...args) => warnings.push(args),
    })

    await relay.post(7, 'failed')
    await relay.post(7, 'recovered')
    await relay.post(7, 'failed-again')

    expect(warnings).toHaveLength(2)
  })
})
