import { describe, it } from 'bun:test'
import assert from 'node:assert'
import { buildBrowserToolSet } from '../../src/agent/tool-adapter'
import { registry } from '../../src/tools/registry'

describe('browser tool adapter', () => {
  it('does not expose model-level approval hooks', () => {
    const tools = buildBrowserToolSet(registry, {
      browser: {} as never,
      directories: {},
    })

    for (const [name, definition] of Object.entries(tools)) {
      assert.strictEqual(
        (definition as { needsApproval?: boolean }).needsApproval,
        undefined,
        `${name} still requests approval`,
      )
    }
  })
})
