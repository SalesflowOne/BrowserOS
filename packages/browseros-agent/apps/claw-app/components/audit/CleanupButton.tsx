/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * The "Storage" button in the audit header. Only renders when the
 * candidates query returns at least one non-empty range (i.e. there
 * IS data older than the smallest threshold). Owns the dialog open
 * state so the header component doesn't have to.
 */

import { Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import type { CleanupCandidateStats } from '@/modules/api/audit.hooks'
import { useAuditCleanupCandidates } from '@/modules/api/audit.hooks'
import { CleanupDialog } from './CleanupDialog'

/**
 * A range is worth showing to the user only when at least one session
 * would be affected. Ranges with zero sessions are omitted entirely
 * from the dialog (per Dani's spec).
 */
function nonEmptyRanges(
  ranges: CleanupCandidateStats[] | undefined,
): CleanupCandidateStats[] {
  return (ranges ?? []).filter((r) => r.sessionCount > 0)
}

export function CleanupButton() {
  const [open, setOpen] = useState(false)
  const candidates = useAuditCleanupCandidates()
  const ranges = nonEmptyRanges(candidates.data?.ranges)

  if (ranges.length === 0) return null

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
        className="h-8 gap-1.5 font-mono text-[11px] text-ink-2 uppercase tracking-[0.08em] hover:bg-card-tint"
      >
        <Trash2 className="size-3.5" />
        Storage
      </Button>
      <CleanupDialog open={open} onOpenChange={setOpen} ranges={ranges} />
    </>
  )
}
