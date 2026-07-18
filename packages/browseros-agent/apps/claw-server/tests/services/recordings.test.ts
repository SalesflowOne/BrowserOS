import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { and, eq, isNull } from 'drizzle-orm'
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

let dir: string
let store: RecordingStore

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'recordings-'))
  setAuditDbForTesting()
  store = createRecordingStore({ rootDir: dir })
})

afterEach(async () => {
  await store.resetForTesting()
  resetAuditDbForTesting()
  await rm(dir, { recursive: true, force: true })
})

describe('RecordingStore', () => {
  it('stamps tabId, appends target-keyed NDJSON, and upserts catalog totals', async () => {
    await store.appendBatch('target-a', 11, [
      { ts: 200, type: 3, data: { value: 'second' } },
      { ts: 100, type: 2, data: { value: 'first' } },
    ])
    await store.appendBatch('target-a', 11, [
      { ts: 300, type: 3, data: { value: 'third' } },
    ])

    const text = await readFile(join(dir, 'target-a.ndjson'), 'utf8')
    const events = text
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
    expect(events).toHaveLength(3)
    expect(events[0]).toEqual({
      tabId: 11,
      ts: 200,
      type: 3,
      data: { value: 'second' },
    })

    const row = getAuditDb()
      .select()
      .from(tabRecordings)
      .where(eq(tabRecordings.targetId, 'target-a'))
      .get()
    expect(row).toEqual({
      targetId: 'target-a',
      tabId: 11,
      firstEventAt: 100,
      lastEventAt: 300,
      sizeBytes: Buffer.byteLength(text),
      eventCount: 3,
    })
  })

  it('reads only events inside an inclusive claim window', async () => {
    await store.appendBatch('target-b', 22, [
      { ts: 100, type: 3, data: {} },
      { ts: 200, type: 3, data: {} },
      { ts: 300, type: 3, data: {} },
    ])

    expect(await store.readRange('target-b', 100, 200)).toEqual([
      { tabId: 22, ts: 100, type: 3, data: {} },
      { tabId: 22, ts: 200, type: 3, data: {} },
    ])
  })

  it('serializes concurrent appends without tearing lines', async () => {
    const events = Array.from({ length: 100 }, (_, index) => ({
      ts: index + 1,
      type: 3,
      data: { index },
    }))

    await Promise.all([
      store.appendBatch('target-c', 33, events.slice(0, 50)),
      store.appendBatch('target-c', 33, events.slice(50)),
    ])

    const text = await readFile(join(dir, 'target-c.ndjson'), 'utf8')
    expect(text.trim().split('\n')).toHaveLength(100)
    expect(() => text.trim().split('\n').map(JSON.parse)).not.toThrow()
  })

  it('does not evict handles while concurrent target appends are active', async () => {
    store = createRecordingStore({ rootDir: dir, maxOpenHandles: 1 })
    const events = Array.from({ length: 2_000 }, (_, index) => ({
      ts: index + 1,
      type: 3,
      data: { value: 'x'.repeat(500) },
    }))

    await Promise.all([
      store.appendBatch('target-one', 1, events),
      store.appendBatch('target-two', 2, events),
    ])

    expect((await store.readRange('target-one', 0, 3_000)).length).toBe(2_000)
    expect((await store.readRange('target-two', 0, 3_000)).length).toBe(2_000)
  })

  it('rolls back appended bytes when the catalog update fails', async () => {
    store = createRecordingStore({
      rootDir: dir,
      getDb: () => {
        throw new Error('catalog unavailable')
      },
    })

    await expect(
      store.appendBatch('target-rollback', 1, [
        { ts: 1, type: 3, data: { value: 'not committed' } },
      ]),
    ).rejects.toThrow('catalog unavailable')

    expect(await readFile(join(dir, 'target-rollback.ndjson'), 'utf8')).toBe('')
  })

  it('sanitizes target ids before using them as filenames', async () => {
    await store.appendBatch('../target/d', 44, [{ ts: 1, type: 3, data: {} }])

    expect(await readFile(join(dir, '.._target_d.ndjson'), 'utf8')).toContain(
      '"tabId":44',
    )
  })

  it('sweeps expired files, catalog rows, and closed claims only', async () => {
    const now = 10 * 24 * 60 * 60 * 1000
    const day = 24 * 60 * 60 * 1000
    await store.appendBatch('old-target', 1, [
      { ts: now - 8 * day, type: 3, data: {} },
    ])
    await store.appendBatch('fresh-target', 2, [
      { ts: now - day, type: 3, data: {} },
    ])
    getAuditDb()
      .insert(tabClaims)
      .values([
        {
          targetId: 'old-target',
          sessionId: 'old-session',
          agentId: 'agent',
          claimedAt: now - 9 * day,
          releasedAt: now - 8 * day,
        },
        {
          targetId: 'fresh-target',
          sessionId: 'fresh-session',
          agentId: 'agent',
          claimedAt: now - 2 * day,
          releasedAt: now - day,
        },
        {
          targetId: 'old-target',
          sessionId: 'open-session',
          agentId: 'agent',
          claimedAt: now - 9 * day,
        },
      ])
      .run()

    const result = await store.sweepRetention(7, now)

    expect(result).toEqual({ recordingsDeleted: 1, claimsDeleted: 1 })
    expect(await Bun.file(join(dir, 'old-target.ndjson')).exists()).toBe(false)
    expect(await Bun.file(join(dir, 'fresh-target.ndjson')).exists()).toBe(true)
    expect(
      getAuditDb()
        .select()
        .from(tabRecordings)
        .where(eq(tabRecordings.targetId, 'old-target'))
        .get(),
    ).toBeUndefined()
    expect(
      getAuditDb()
        .select()
        .from(tabClaims)
        .where(
          and(
            eq(tabClaims.sessionId, 'open-session'),
            isNull(tabClaims.releasedAt),
          ),
        )
        .get(),
    ).toBeDefined()
  })
})
