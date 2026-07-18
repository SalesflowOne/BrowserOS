import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  getAuditDb,
  resetAuditDbForTesting,
  setAuditDbForTesting,
} from '../../src/modules/db/db'
import { tabClaims } from '../../src/modules/db/schema/tab-claims.sql'
import { tabRecordings } from '../../src/modules/db/schema/tab-recordings.sql'
import {
  createRecordingStore,
  type RecordingStore,
} from '../../src/services/recordings'
import { createReplayService } from '../../src/services/replays'

let dir: string
let store: RecordingStore

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'replays-'))
  setAuditDbForTesting()
  store = createRecordingStore({ rootDir: dir })
})

afterEach(async () => {
  await store.resetForTesting()
  resetAuditDbForTesting()
  await rm(dir, { recursive: true, force: true })
})

describe('ReplayService', () => {
  it('merges claimed target slices by timestamp and excludes unclaimed targets', async () => {
    await store.appendBatch('target-a', 11, [
      { ts: 90, type: 3, data: { id: 'outside' } },
      { ts: 100, type: 3, data: { id: 'a1' } },
      { ts: 200, type: 3, data: { id: 'a2' } },
    ])
    await store.appendBatch('target-b', 22, [
      { ts: 160, type: 3, data: { id: 'b1' } },
      { ts: 180, type: 3, data: { id: 'b2-buffered' } },
    ])
    await store.appendBatch('target-c', 33, [
      { ts: 170, type: 3, data: { id: 'unclaimed' } },
    ])
    getAuditDb()
      .insert(tabClaims)
      .values([
        {
          targetId: 'target-a',
          sessionId: 'session-a',
          agentId: 'agent',
          claimedAt: 100,
          releasedAt: 200,
        },
        {
          targetId: 'target-b',
          sessionId: 'session-a',
          agentId: 'agent',
          claimedAt: 150,
          releasedAt: 170,
        },
      ])
      .run()
    const service = createReplayService({ recordingStore: store })

    const replay = await service.readSession('session-a')

    expect(replay.map((event) => event.data)).toEqual([
      { id: 'a1' },
      { id: 'b1' },
      { id: 'b2-buffered' },
      { id: 'a2' },
    ])
    expect(replay[0]).toMatchObject({
      sessionId: 'session-a',
      targetId: 'target-a',
      tabId: 11,
    })
  })

  it('builds per-target metadata without reading files', async () => {
    await store.appendBatch('target-a', 11, [
      { ts: 90, type: 3, data: {} },
      { ts: 200, type: 3, data: {} },
    ])
    await store.appendBatch('target-b', 22, [
      { ts: 160, type: 3, data: {} },
      { ts: 180, type: 3, data: {} },
    ])
    getAuditDb()
      .insert(tabClaims)
      .values([
        {
          targetId: 'target-a',
          sessionId: 'session-a',
          agentId: 'agent',
          claimedAt: 100,
          releasedAt: 200,
        },
        {
          targetId: 'target-b',
          sessionId: 'session-a',
          agentId: 'agent',
          claimedAt: 150,
          releasedAt: 170,
        },
      ])
      .run()
    const rows = getAuditDb().select().from(tabRecordings).all()
    const sizeBytes = rows.reduce((sum, row) => sum + row.sizeBytes, 0)
    const service = createReplayService({ recordingStore: store })

    expect(service.getMeta('session-a')).toEqual({
      exists: true,
      firstEventAt: 100,
      lastEventAt: 200,
      sizeBytes,
      targets: [
        {
          targetId: 'target-a',
          tabId: 11,
          firstEventAt: 100,
          lastEventAt: 200,
        },
        {
          targetId: 'target-b',
          tabId: 22,
          firstEventAt: 160,
          lastEventAt: 170,
        },
      ],
    })
  })

  it('returns empty replay and metadata for a session without claims', async () => {
    const service = createReplayService({ recordingStore: store })

    expect(await service.readSession('missing')).toEqual([])
    expect(service.getMeta('missing')).toEqual({
      exists: false,
      sizeBytes: 0,
      targets: [],
    })
  })
})
