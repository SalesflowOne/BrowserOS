import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { validateOutput } from '../../src/collectors/validator'
import type { CollectedRecord } from '../../src/types/collection-target'

const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

async function setupValidRecord(outDir: string, id: string = 'hn_abcdef12') {
  await mkdir(join(outDir, 'screenshots'), { recursive: true })
  await mkdir(join(outDir, 'raw'), { recursive: true })
  const pngPath = join(outDir, 'screenshots', `${id}.png`)
  await writeFile(pngPath, Buffer.from(TINY_PNG_BASE64, 'base64'))
  const record: CollectedRecord = {
    id,
    url: 'https://example.com/',
    site: 'hn',
    viewport: { width: 1280, height: 800 },
    scroll_y: 0,
    screenshot_path: `screenshots/${id}.png`,
    snapshot: '[1] button "a"\n[2] link "b"',
    elements: [
      {
        backend_id: 1,
        role: 'button',
        name: 'a',
        bbox: [0, 0, 10, 10],
        snapshot_line: '[1] button "a"',
        in_viewport: true,
      },
      {
        backend_id: 2,
        role: 'link',
        name: 'b',
        bbox: [20, 20, 30, 30],
        snapshot_line: '[2] link "b"',
        in_viewport: true,
      },
    ],
  }
  await writeFile(
    join(outDir, 'raw', `${id}.json`),
    JSON.stringify(record, null, 2),
  )
  return { record, id }
}

describe('validateOutput', () => {
  let outDir: string

  beforeEach(async () => {
    outDir = await mkdtemp(join(tmpdir(), 'vl-validate-'))
  })
  afterEach(async () => {
    await rm(outDir, { recursive: true, force: true })
  })

  it('returns empty errors for a valid record', async () => {
    await setupValidRecord(outDir)
    const errors = await validateOutput(outDir, outDir)
    expect(errors).toEqual([])
  })

  it('flags mismatched snapshot vs elements count', async () => {
    const { id } = await setupValidRecord(outDir)
    const recordPath = join(outDir, 'raw', `${id}.json`)
    const r = JSON.parse(await Bun.file(recordPath).text()) as CollectedRecord
    r.snapshot = '[1] button "a"'
    await writeFile(recordPath, JSON.stringify(r, null, 2))
    const errors = await validateOutput(outDir, outDir)
    expect(errors.join(' ')).toMatch(/snapshot has 1 lines but elements has 2/)
  })

  it('flags duplicate backend_id', async () => {
    const { id } = await setupValidRecord(outDir)
    const recordPath = join(outDir, 'raw', `${id}.json`)
    const r = JSON.parse(await Bun.file(recordPath).text()) as CollectedRecord
    r.elements[1].backend_id = 1
    r.elements[1].snapshot_line = '[1] link "b"'
    r.snapshot = '[1] button "a"\n[1] link "b"'
    await writeFile(recordPath, JSON.stringify(r, null, 2))
    const errors = await validateOutput(outDir, outDir)
    expect(errors.join(' ')).toMatch(/duplicate backend_id 1/)
  })

  it('flags bad bbox (x1 > x2)', async () => {
    const { id } = await setupValidRecord(outDir)
    const recordPath = join(outDir, 'raw', `${id}.json`)
    const r = JSON.parse(await Bun.file(recordPath).text()) as CollectedRecord
    r.elements[0].bbox = [100, 0, 50, 10]
    await writeFile(recordPath, JSON.stringify(r, null, 2))
    const errors = await validateOutput(outDir, outDir)
    expect(errors.join(' ')).toMatch(/bad bbox/)
  })

  it('flags missing screenshot file', async () => {
    const { id } = await setupValidRecord(outDir)
    await rm(join(outDir, 'screenshots', `${id}.png`))
    const errors = await validateOutput(outDir, outDir)
    expect(errors.join(' ')).toMatch(/screenshot_path missing/)
  })

  it('flags id that does not match filename stem', async () => {
    const { id } = await setupValidRecord(outDir, 'hn_deadbeef')
    const recordPath = join(outDir, 'raw', `${id}.json`)
    const r = JSON.parse(await Bun.file(recordPath).text()) as CollectedRecord
    r.id = 'hn_11111111'
    await writeFile(recordPath, JSON.stringify(r, null, 2))
    const errors = await validateOutput(outDir, outDir)
    expect(errors.join(' ')).toMatch(/does not match filename stem/)
  })

  it('returns an error when raw dir has no json records', async () => {
    await mkdir(join(outDir, 'raw'), { recursive: true })
    await mkdir(join(outDir, 'screenshots'), { recursive: true })
    const errors = await validateOutput(outDir, outDir)
    expect(errors.join(' ')).toMatch(/no \.json records/)
  })
})
