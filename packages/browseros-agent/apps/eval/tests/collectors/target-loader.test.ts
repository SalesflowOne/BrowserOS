import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  loadCollectionTargets,
  TargetLoadError,
} from '../../src/collectors/target-loader'

describe('loadCollectionTargets', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'vl-seeds-'))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  async function writeSeeds(lines: string[]): Promise<string> {
    const path = join(dir, 'seeds.jsonl')
    await writeFile(path, lines.join('\n'))
    return path
  }

  it('loads a single valid target', async () => {
    const path = await writeSeeds([
      JSON.stringify({
        site: 'hn',
        url: 'https://news.ycombinator.com/',
        states: [{ kind: 'initial' }],
      }),
    ])
    const targets = await loadCollectionTargets(path)
    expect(targets.length).toBe(1)
    expect(targets[0].site).toBe('hn')
    expect(targets[0].states[0]).toEqual({ kind: 'initial' })
  })

  it('applies default wait_ms for click_and_wait state', async () => {
    const path = await writeSeeds([
      JSON.stringify({
        site: 'a',
        url: 'https://example.com/',
        states: [{ kind: 'click_and_wait', backend_id: 42 }],
      }),
    ])
    const [target] = await loadCollectionTargets(path)
    expect(target.states[0]).toEqual({
      kind: 'click_and_wait',
      backend_id: 42,
      wait_ms: 1000,
    })
  })

  it('loads multiple targets and preserves order', async () => {
    const path = await writeSeeds([
      JSON.stringify({
        site: 'a',
        url: 'https://a.example/',
        states: [{ kind: 'initial' }],
      }),
      JSON.stringify({
        site: 'b',
        url: 'https://b.example/',
        states: [{ kind: 'scroll', pixels: 500 }],
      }),
    ])
    const targets = await loadCollectionTargets(path)
    expect(targets.map((t) => t.site)).toEqual(['a', 'b'])
  })

  it('throws on duplicate site slugs', async () => {
    const path = await writeSeeds([
      JSON.stringify({
        site: 'dup',
        url: 'https://a.example/',
        states: [{ kind: 'initial' }],
      }),
      JSON.stringify({
        site: 'dup',
        url: 'https://b.example/',
        states: [{ kind: 'initial' }],
      }),
    ])
    await expect(loadCollectionTargets(path)).rejects.toThrow(TargetLoadError)
  })

  it('throws with line number on invalid JSON', async () => {
    const path = await writeSeeds([
      JSON.stringify({
        site: 'a',
        url: 'https://a.example/',
        states: [{ kind: 'initial' }],
      }),
      'not json',
    ])
    await expect(loadCollectionTargets(path)).rejects.toThrow(/Line 2/)
  })

  it('throws on invalid site slug (uppercase)', async () => {
    const path = await writeSeeds([
      JSON.stringify({
        site: 'BadSlug',
        url: 'https://a.example/',
        states: [{ kind: 'initial' }],
      }),
    ])
    await expect(loadCollectionTargets(path)).rejects.toThrow(/site/)
  })

  it('throws on empty file', async () => {
    const path = await writeSeeds([])
    await expect(loadCollectionTargets(path)).rejects.toThrow(/empty/)
  })

  it('throws on missing file', async () => {
    await expect(
      loadCollectionTargets(join(dir, 'nope.jsonl')),
    ).rejects.toThrow(TargetLoadError)
  })
})
