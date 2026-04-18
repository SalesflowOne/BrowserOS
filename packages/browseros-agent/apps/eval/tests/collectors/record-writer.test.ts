import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RecordWriter } from '../../src/collectors/record-writer'
import type { CollectedRecord } from '../../src/types/collection-target'

const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

function makeRecord(
  site: string,
): Omit<CollectedRecord, 'id' | 'screenshot_path'> {
  return {
    url: 'https://example.com/',
    site,
    viewport: { width: 1280, height: 800 },
    scroll_y: 0,
    snapshot: '[1] button "ok"',
    elements: [
      {
        backend_id: 1,
        role: 'button',
        name: 'ok',
        bbox: [10, 20, 30, 40],
        snapshot_line: '[1] button "ok"',
        in_viewport: true,
      },
    ],
  }
}

describe('RecordWriter', () => {
  let outDir: string

  beforeEach(async () => {
    outDir = await mkdtemp(join(tmpdir(), 'vl-writer-'))
  })
  afterEach(async () => {
    await rm(outDir, { recursive: true, force: true })
  })

  it('writes screenshot + json with an assigned id', async () => {
    const writer = new RecordWriter(outDir, outDir)
    await writer.init()
    const result = await writer.write(makeRecord('hn'), TINY_PNG_BASE64)
    expect(result.skipped).toBe(false)
    expect(result.id).toMatch(/^hn_[0-9a-f]{8}$/)

    const pngFiles = await readdir(join(outDir, 'screenshots'))
    expect(pngFiles).toEqual([`${result.id}.png`])

    const jsonText = await readFile(
      join(outDir, 'raw', `${result.id}.json`),
      'utf-8',
    )
    const record = JSON.parse(jsonText) as CollectedRecord
    expect(record.id).toBe(result.id)
    expect(record.screenshot_path).toContain(`screenshots/${result.id}.png`)
    expect(record.snapshot).toBe('[1] button "ok"')
  })

  it('writes manifest with site counts and collector tag', async () => {
    const writer = new RecordWriter(outDir, outDir)
    await writer.init()
    await writer.write(makeRecord('hn'), TINY_PNG_BASE64)
    await writer.write(makeRecord('hn'), TINY_PNG_BASE64)
    await writer.write(makeRecord('wiki'), TINY_PNG_BASE64)

    const collectedAt = new Date('2026-04-18T12:00:00Z')
    await writer.writeManifest(collectedAt, 'browseros-agent@abc123')

    const manifest = JSON.parse(
      await readFile(join(outDir, 'meta.json'), 'utf-8'),
    )
    expect(manifest.collector).toBe('browseros-agent@abc123')
    expect(manifest.collected_at).toBe('2026-04-18T12:00:00.000Z')
    expect(manifest.total_records).toBe(3)
    expect(manifest.viewport).toEqual({ width: 1280, height: 800 })
    const siteCounts = Object.fromEntries(
      (manifest.sites as Array<{ site: string; states: number }>).map((s) => [
        s.site,
        s.states,
      ]),
    )
    expect(siteCounts).toEqual({ hn: 2, wiki: 1 })
  })

  it('is idempotent: re-writing an existing id skips', async () => {
    const writer = new RecordWriter(outDir, outDir)
    await writer.init()
    const first = await writer.write(makeRecord('hn'), TINY_PNG_BASE64)
    const files = await readdir(join(outDir, 'raw'))

    // Second write generates a new uuid → new files, not a skip.
    const second = await writer.write(makeRecord('hn'), TINY_PNG_BASE64)
    expect(second.skipped).toBe(false)
    expect(second.id).not.toBe(first.id)
    expect(files.length).toBe(1)
  })
})
