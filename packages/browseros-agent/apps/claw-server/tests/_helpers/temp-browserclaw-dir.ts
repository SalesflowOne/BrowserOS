/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Test helper: redirects the claw-server package's storage root to a
 * fresh tmp directory so each test is isolated. The override is set
 * on the shared `env` object (read once at module load), then nudged
 * back to its prior value after the test.
 *
 * As a safety net every test also gets a no-op `McpManager` stub
 * swapped in so harness-install side-effects in `agents.create` /
 * `agents.remove` never touch the user's real `~/.claude.json`. Tests
 * that want to assert on install behaviour can override the stub
 * inside the body by calling `setMcpManagerForTesting(myStub)`.
 *
 * Use as a wrapper:
 *
 *   await withTempBrowserClawDir(async () => {
 *     // body runs against an isolated <browserclawDir>
 *   })
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { env } from '../../src/env'
import {
  resetMcpManagerForTesting,
  setMcpManagerForTesting,
} from '../../src/lib/mcp-manager'
import { createStubMcpManager } from './stub-mcp-manager'

export async function withTempBrowserClawDir<T>(
  body: (dir: string) => Promise<T>,
): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'browserclaw-server-'))
  const prior = env.browserclawDirOverride
  env.browserclawDirOverride = dir
  setMcpManagerForTesting(createStubMcpManager())
  try {
    return await body(dir)
  } finally {
    env.browserclawDirOverride = prior
    // Drop the stub so any test that didn't use `withTempBrowserClawDir`
    // gets a fresh real-or-injected manager next time.
    resetMcpManagerForTesting()
    await rm(dir, { recursive: true, force: true })
  }
}
