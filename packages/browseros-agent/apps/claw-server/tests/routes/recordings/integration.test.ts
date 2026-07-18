import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { env } from '../../../src/env'
import {
  initializeTabTargets,
  stopTabTargets,
} from '../../../src/lib/tab-targets'
import {
  getAuditDb,
  resetAuditDbForTesting,
  setAuditDbForTesting,
} from '../../../src/modules/db/db'
import { tabClaims } from '../../../src/modules/db/schema/tab-claims.sql'
import app from '../../../src/server'
import { recordingStore } from '../../../src/services/recordings'

let dir: string
let previousRoot: string | undefined

function fakeBrowserSession() {
  return {
    connectionEpoch: () => 1,
    protocol: {
      Browser: {
        getTabs: async () => ({
          tabs: [
            { tabId: 11, targetId: 'target-a' },
            { tabId: 22, targetId: 'target-b' },
          ],
        }),
        getTabInfo: async ({ tabId }: { tabId: number }) => {
          const targetId = tabId === 11 ? 'target-a' : 'target-b'
          return { tab: { tabId, targetId } }
        },
      },
      Target: {
        setDiscoverTargets: async () => undefined,
        on: () => () => undefined,
      },
    },
  }
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'recordings-integration-'))
  previousRoot = env.browserClawDirOverride
  env.browserClawDirOverride = dir
  setAuditDbForTesting()
  await initializeTabTargets(fakeBrowserSession() as never)
})

afterEach(async () => {
  stopTabTargets()
  await recordingStore.resetForTesting()
  resetAuditDbForTesting()
  env.browserClawDirOverride = previousRoot
  await rm(dir, { recursive: true, force: true })
})

describe('record-everything pipeline', () => {
  it('ingests two tabs and replays only claimed events in timestamp order', async () => {
    const health = await app.fetch(
      new Request('http://localhost/recordings/health'),
    )
    expect(await health.json()).toEqual({ ok: true })

    const firstPost = await app.fetch(
      new Request('http://localhost/recordings/tabs/11/events', {
        method: 'POST',
        body: [
          JSON.stringify({ ts: 400, type: 3, data: { id: 'later' } }),
          JSON.stringify({ ts: 100, type: 3, data: { id: 'before' } }),
          JSON.stringify({ ts: 300, type: 3, data: { id: 'earlier' } }),
          JSON.stringify({ ts: 6_000, type: 3, data: { id: 'after' } }),
        ].join('\n'),
      }),
    )
    const secondPost = await app.fetch(
      new Request('http://localhost/recordings/tabs/22/events', {
        method: 'POST',
        body: JSON.stringify({
          ts: 350,
          type: 3,
          data: { id: 'unclaimed' },
        }),
      }),
    )
    expect(await firstPost.json()).toEqual({ ok: true, accepted: 4 })
    expect(await secondPost.json()).toEqual({ ok: true, accepted: 1 })

    getAuditDb()
      .insert(tabClaims)
      .values({
        targetId: 'target-a',
        sessionId: 'session-a',
        agentId: 'agent',
        claimedAt: 200,
        releasedAt: 400,
      })
      .run()

    const replay = await app.fetch(
      new Request('http://localhost/audit/replays/session-a'),
    )
    expect(replay.status).toBe(200)
    expect(replay.headers.get('content-type')).toContain('application/x-ndjson')
    const events = (await replay.text())
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
    expect(events.map((event) => event.ts)).toEqual([300, 400])
    expect(events.every((event) => event.targetId === 'target-a')).toBe(true)
    expect(events.every((event) => event.sessionId === 'session-a')).toBe(true)

    const meta = await app.fetch(
      new Request('http://localhost/audit/replays/session-a/meta'),
    )
    expect(await meta.json()).toMatchObject({
      exists: true,
      firstEventAt: 200,
      lastEventAt: 400,
      targets: [
        {
          targetId: 'target-a',
          tabId: 11,
          firstEventAt: 200,
          lastEventAt: 400,
        },
      ],
    })
  })
})
