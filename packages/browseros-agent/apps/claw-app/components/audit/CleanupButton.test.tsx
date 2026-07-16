/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Static-markup checks for the audit CleanupButton's visibility gate.
 * Interactive two-stage dialog behaviour is covered by the pure-logic
 * unit tests in `cleanup.helpers.test.ts` (phrase builder + comparator)
 * plus the server-side audit-cleanup tests. This file only asserts the
 * outer rule: the button hides itself when there is nothing to clean.
 */

import { describe, expect, it, mock } from 'bun:test'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderToStaticMarkup } from 'react-dom/server'
import type { CleanupCandidatesResponse } from '@/modules/api/audit.hooks'
import * as auditHooks from '@/modules/api/audit.hooks'

let candidatesOverride: CleanupCandidatesResponse | undefined

// Re-export the real module surface with only the two cleanup hooks
// stubbed. Preserves useTasks, useTaskDetail, useDispatches etc. for
// any downstream consumer (Audit.test.tsx runs in the same process
// and would otherwise resolve to a mock that's missing those exports).
mock.module('@/modules/api/audit.hooks', () => ({
  ...auditHooks,
  useAuditCleanupCandidates: () => ({ data: candidatesOverride }),
  useAuditCleanup: () => ({ mutate: () => {}, isPending: false }),
}))

const { CleanupButton } = await import('./CleanupButton')

function render(): string {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <CleanupButton />
    </QueryClientProvider>,
  )
}

describe('CleanupButton visibility', () => {
  it('renders nothing when candidates data is still loading', () => {
    candidatesOverride = undefined
    expect(render()).toBe('')
  })

  it('renders nothing when every range has zero sessions', () => {
    candidatesOverride = {
      ranges: [
        {
          olderThanDays: 15,
          sessionCount: 0,
          dispatchCount: 0,
          bytesOnDisk: 0,
        },
        {
          olderThanDays: 30,
          sessionCount: 0,
          dispatchCount: 0,
          bytesOnDisk: 0,
        },
        {
          olderThanDays: 90,
          sessionCount: 0,
          dispatchCount: 0,
          bytesOnDisk: 0,
        },
      ],
    }
    expect(render()).toBe('')
  })

  it('renders the Storage button when at least one range has sessions', () => {
    candidatesOverride = {
      ranges: [
        {
          olderThanDays: 15,
          sessionCount: 3,
          dispatchCount: 12,
          bytesOnDisk: 1000,
        },
        {
          olderThanDays: 30,
          sessionCount: 0,
          dispatchCount: 0,
          bytesOnDisk: 0,
        },
        {
          olderThanDays: 90,
          sessionCount: 0,
          dispatchCount: 0,
          bytesOnDisk: 0,
        },
      ],
    }
    const html = render()
    expect(html).toContain('Storage')
  })
})
