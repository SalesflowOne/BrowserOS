import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const repoRoot = resolve(import.meta.dir, '../../../..')
const workflow = readFileSync(
  resolve(repoRoot, '.github/workflows/release-server.yml'),
  'utf8',
)
const shellVersionPlaceholder = '$' + '{VERSION}'
const expectedBumpBranch = `chore-bump-server-v${shellVersionPlaceholder}`

function reflectVersionStep(): string {
  const start = workflow.indexOf('- name: Reflect version on main via PR')
  expect(start).toBeGreaterThanOrEqual(0)
  return workflow.slice(start)
}

describe('release-server workflow', () => {
  it('uses a flat branch for post-release version bump PRs', () => {
    const step = reflectVersionStep()
    const branch = step.match(/^\s*BRANCH="([^"]+)"$/m)?.[1]

    expect(branch).toBe(expectedBumpBranch)
    expect(branch?.startsWith('release/')).toBe(false)
  })

  it('fails visibly when post-release version reflection fails', () => {
    const step = reflectVersionStep()

    expect(step).not.toContain('continue-on-error: true')
    expect(step).toContain('GITHUB_STEP_SUMMARY')
    expect(step).toContain('::error::')
  })

  it('creates a missing PR when the remote bump branch already exists', () => {
    const step = reflectVersionStep()

    expect(step).toContain('gh pr list --state open --head "$BRANCH"')
    expect(step).toContain(
      'Branch $BRANCH already exists without an open bump PR; creating it.',
    )
    expect(step).toContain('create_reflection_pr')
  })
})
