/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Two-stage confirmation for the destructive /audit/cleanup call.
 *
 *   Stage 1  Pick a range. Radios for whichever thresholds have data.
 *            Nothing dangerous happens here; Continue is neutral.
 *
 *   Stage 2  Typed-confirmation gate. Read-back line + input where the
 *            user has to type "delete N sessions older than D days"
 *            verbatim before Delete unlocks. Case-sensitive exact
 *            match. Rebuilds when the range changes so muscle memory
 *            from a prior cleanup cannot unlock a new one. Same
 *            pattern as GitHub repo delete / Stripe account delete.
 *
 * Failure clears the typed input so hitting Enter without re-reading
 * cannot retry silently.
 */

import { AlertTriangle } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import type {
  CleanupCandidateStats,
  CleanupResult,
} from '@/modules/api/audit.hooks'
import { useAuditCleanup } from '@/modules/api/audit.hooks'
import {
  buildConfirmationPhrase,
  formatBytes,
  matchesConfirmationPhrase,
} from './cleanup.helpers'

interface CleanupDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Only the non-empty ranges. Empty ones are filtered by the caller. */
  ranges: CleanupCandidateStats[]
  onSuccess?: (result: CleanupResult) => void
}

type Stage = 'pick' | 'confirm'

export function CleanupDialog({
  open,
  onOpenChange,
  ranges,
  onSuccess,
}: CleanupDialogProps) {
  const [stage, setStage] = useState<Stage>('pick')
  const [selectedDays, setSelectedDays] = useState<number | null>(
    ranges.length === 1 ? (ranges[0]?.olderThanDays ?? null) : null,
  )
  const [typed, setTyped] = useState('')
  const [errorText, setErrorText] = useState<string | null>(null)
  const cleanup = useAuditCleanup()
  // Track the previous `open` value so the reset effect below fires
  // ONLY on a false→true transition (the moment the user opens the
  // dialog) and not on every unrelated re-render. Without this guard,
  // the candidates poll (30s refetch) hands `CleanupButton` a fresh
  // `ranges` array reference on every tick; that would ripple through
  // the effect deps and wipe Stage 2 progress out from under a user
  // who takes longer than the poll interval to read + type the
  // confirmation phrase.
  const prevOpenRef = useRef(open)

  useEffect(() => {
    const justOpened = open && !prevOpenRef.current
    prevOpenRef.current = open
    if (!justOpened) return
    setStage('pick')
    setSelectedDays(
      ranges.length === 1 ? (ranges[0]?.olderThanDays ?? null) : null,
    )
    setTyped('')
    setErrorText(null)
  }, [open, ranges])

  const selected = ranges.find((r) => r.olderThanDays === selectedDays) ?? null
  const phrase = selected
    ? buildConfirmationPhrase(selected.sessionCount, selected.olderThanDays)
    : ''
  const canDelete =
    stage === 'confirm' &&
    !!selected &&
    !cleanup.isPending &&
    matchesConfirmationPhrase(typed, phrase)

  const handleContinue = () => {
    if (!selected) return
    setStage('confirm')
  }

  const handleBack = () => {
    setStage('pick')
    setTyped('')
    setErrorText(null)
  }

  const handleDelete = () => {
    if (!canDelete || !selected) return
    setErrorText(null)
    cleanup.mutate(
      { olderThanDays: selected.olderThanDays },
      {
        onSuccess: (res) => {
          onSuccess?.(res)
          onOpenChange(false)
        },
        onError: () => {
          setErrorText(
            'The cleanup failed. Read the confirmation again and try once more.',
          )
          setTyped('')
        },
      },
    )
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        {stage === 'pick' ? (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete old audit data</AlertDialogTitle>
              <AlertDialogDescription>
                Deletes sessions, replays, and screenshots older than the
                selected age. This cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <RadioGroup
              value={selectedDays !== null ? String(selectedDays) : undefined}
              onValueChange={(v) => setSelectedDays(Number(v))}
              className="gap-2"
            >
              {ranges.map((r) => (
                <label
                  key={r.olderThanDays}
                  htmlFor={`cleanup-range-${r.olderThanDays}`}
                  className="flex cursor-pointer items-start gap-3 rounded-md border border-border p-3 hover:bg-muted"
                >
                  <RadioGroupItem
                    id={`cleanup-range-${r.olderThanDays}`}
                    value={String(r.olderThanDays)}
                    className="mt-0.5"
                  />
                  <span className="flex flex-col text-left">
                    <span className="font-medium">
                      Older than {r.olderThanDays} days
                    </span>
                    <span className="text-muted-foreground text-xs">
                      {r.sessionCount}{' '}
                      {r.sessionCount === 1 ? 'session' : 'sessions'} · up to{' '}
                      {formatBytes(r.bytesOnDisk)}
                    </span>
                  </span>
                </label>
              ))}
            </RadioGroup>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <Button
                type="button"
                onClick={handleContinue}
                disabled={selected === null}
              >
                Continue
              </Button>
            </AlertDialogFooter>
          </>
        ) : (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2">
                <AlertTriangle className="size-5 text-destructive" />
                Type to confirm
              </AlertDialogTitle>
              <AlertDialogDescription>
                You are about to delete{' '}
                <strong>
                  {selected?.sessionCount}{' '}
                  {selected?.sessionCount === 1 ? 'session' : 'sessions'} older
                  than {selected?.olderThanDays} days
                </strong>
                . This frees up to {formatBytes(selected?.bytesOnDisk ?? 0)} and
                cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="flex flex-col gap-2">
              <p className="text-muted-foreground text-xs">
                Type the phrase below exactly to enable the Delete button:
              </p>
              <code className="rounded bg-muted px-2 py-1.5 font-mono text-xs">
                {phrase}
              </code>
              <Input
                autoFocus
                spellCheck={false}
                autoComplete="off"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder=""
                className="font-mono text-xs"
                data-testid="cleanup-confirm-input"
              />
              {errorText && (
                <p className="text-destructive text-xs" role="alert">
                  {errorText}
                </p>
              )}
            </div>
            <AlertDialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={handleBack}
                disabled={cleanup.isPending}
              >
                Back
              </Button>
              <AlertDialogAction
                variant="destructive"
                onClick={handleDelete}
                disabled={!canDelete}
                data-testid="cleanup-confirm-delete"
              >
                {cleanup.isPending ? 'Deleting…' : 'Delete'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </>
        )}
      </AlertDialogContent>
    </AlertDialog>
  )
}
