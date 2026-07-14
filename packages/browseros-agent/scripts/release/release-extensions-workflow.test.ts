import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const repoRoot = resolve(import.meta.dir, '../../../..')
const workflow = readFileSync(
  resolve(repoRoot, '.github/workflows/release-extensions.yml'),
  'utf8',
)

describe('release-extensions workflow', () => {
  it('forwards optional BrowserClaw PostHog values into extension builds', () => {
    expect(workflow).toMatch(/VITE_CLAW_POSTHOG_KEY:\n\s+required: false/)
    expect(workflow).toMatch(/VITE_CLAW_POSTHOG_HOST:\n\s+required: false/)
    expect(workflow).toContain(
      `VITE_CLAW_POSTHOG_KEY: ${'$'}{{ secrets.VITE_CLAW_POSTHOG_KEY }}`,
    )
    expect(workflow).toContain(
      `VITE_CLAW_POSTHOG_HOST: ${'$'}{{ secrets.VITE_CLAW_POSTHOG_HOST }}`,
    )
  })
})
