/**
 * E2E tests for remote skill sync against live CDN.
 * These hit the real https://cdn.browseros.com/skills/v1/catalog.json
 */

import { afterEach, beforeEach, describe, it, mock } from 'bun:test'
import assert from 'node:assert'
import { mkdtemp, readdir, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let testDir: string

const mockGetSkillsDir = mock(() => testDir)

mock.module('../../src/lib/browseros-dir', () => ({
  getSkillsDir: mockGetSkillsDir,
}))

// Override the catalog URL env to hit real CDN
mock.module('../../src/env', () => ({
  INLINED_ENV: {
    SKILLS_CATALOG_URL: 'https://cdn.browseros.com/skills/v1/catalog.json',
  },
}))

const { fetchRemoteCatalog, seedFromRemote, syncRemoteSkills, loadManifest } =
  await import('../../src/skills/remote-sync')

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), 'e2e-skill-sync-'))
})

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true })
})

describe('E2E: fetch remote catalog from live CDN', () => {
  it('fetches catalog with 12 skills from cdn.browseros.com', async () => {
    const catalog = await fetchRemoteCatalog()
    assert.ok(catalog, 'Catalog should not be null')
    assert.strictEqual(catalog.version, 1)
    assert.strictEqual(catalog.skills.length, 12)

    const ids = catalog.skills.map((s) => s.id).sort()
    assert.ok(ids.includes('summarize-page'))
    assert.ok(ids.includes('deep-research'))
    assert.ok(ids.includes('extract-data'))

    for (const skill of catalog.skills) {
      assert.ok(skill.id, 'Skill must have an id')
      assert.ok(skill.version, 'Skill must have a version')
      assert.ok(skill.content.includes('---'), 'Skill must have frontmatter')
    }
  })
})

describe('E2E: seed from remote (fresh install)', () => {
  it('seeds all skills to empty directory from live CDN', async () => {
    const result = await seedFromRemote()
    assert.strictEqual(result, true)

    const entries = await readdir(testDir)
    const skillDirs = entries.filter((e) => !e.startsWith('.'))
    assert.strictEqual(skillDirs.length, 12)

    // Verify a skill file has correct content
    const content = await readFile(
      join(testDir, 'summarize-page', 'SKILL.md'),
      'utf-8',
    )
    assert.ok(content.includes('name: summarize-page'))
    assert.ok(content.includes('Summarize Page'))

    // Verify manifest was written
    const manifest = await loadManifest()
    assert.strictEqual(Object.keys(manifest.skills).length, 12)
    assert.ok(manifest.lastSyncedAt)
    assert.ok(manifest.skills['summarize-page'].version)
    assert.ok(manifest.skills['summarize-page'].contentHash)
  })
})

describe('E2E: sync with existing skills', () => {
  it('skips all skills when already at latest version', async () => {
    // Seed first
    await seedFromRemote()

    // Sync again — everything should be up to date
    const result = await syncRemoteSkills()
    assert.strictEqual(result.installed, 0)
    assert.strictEqual(result.updated, 0)
    assert.strictEqual(result.skipped, 0)
  })

  it('skips user-customized skills during sync', async () => {
    // Seed first
    await seedFromRemote()

    // User customizes a skill
    const skillPath = join(testDir, 'summarize-page', 'SKILL.md')
    const original = await readFile(skillPath, 'utf-8')
    await writeFile(skillPath, original + '\n\n## My Custom Notes\n')

    // Manually bump version in manifest to force a version mismatch
    const manifestPath = join(testDir, '.remote-manifest.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf-8'))
    manifest.skills['summarize-page'].version = '0.9'
    await writeFile(manifestPath, JSON.stringify(manifest))

    // Sync — should skip summarize-page because content was modified
    const result = await syncRemoteSkills()
    assert.strictEqual(result.skipped, 1)

    // Verify the customization is preserved
    const afterSync = await readFile(skillPath, 'utf-8')
    assert.ok(afterSync.includes('## My Custom Notes'))
  })

  it('installs new skills that only exist remotely', async () => {
    // Seed first, then delete one skill locally
    await seedFromRemote()

    const { rm: rmDir } = await import('node:fs/promises')
    await rmDir(join(testDir, 'deep-research'), { recursive: true })

    // Remove from manifest so sync sees it as new
    const manifestPath = join(testDir, '.remote-manifest.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf-8'))
    delete manifest.skills['deep-research']
    await writeFile(manifestPath, JSON.stringify(manifest))

    const result = await syncRemoteSkills()
    assert.strictEqual(result.installed, 1)

    // Verify it was re-installed
    const content = await readFile(
      join(testDir, 'deep-research', 'SKILL.md'),
      'utf-8',
    )
    assert.ok(content.includes('name: deep-research'))
  })
})
