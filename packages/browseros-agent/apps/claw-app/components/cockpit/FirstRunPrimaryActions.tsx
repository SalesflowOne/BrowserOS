/**
 * @license
 * Copyright 2026 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * The primary action row on the cockpit first-run block. Two
 * buttons side-by-side: navigate to MCP setup, or copy the starter
 * prompt (delegated to the sibling `StarterPromptTile`). The tile
 * lives below for the actual copy affordance; this row is the
 * eye-line CTA that names both actions.
 */

import { ArrowRight, ChevronsUp, ClipboardCopy } from 'lucide-react'
import { NavLink } from 'react-router'

interface FirstRunPrimaryActionsProps {
  installHref: string
  installLabel: string
  copyLabel: string
  installStatus: 'active' | 'done'
  onCopyClick: () => void
}

export function FirstRunPrimaryActions({
  installHref,
  installLabel,
  copyLabel,
  installStatus,
  onCopyClick,
}: FirstRunPrimaryActionsProps) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <NavLink
        to={installHref}
        className={
          installStatus === 'active'
            ? 'inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-accent px-6 py-3 font-semibold text-[14px] text-card shadow-card transition hover:brightness-110 sm:flex-none'
            : 'inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-border-2 bg-card px-6 py-3 font-semibold text-[14px] text-ink transition hover:border-border-strong sm:flex-none'
        }
      >
        {installStatus === 'active' ? <ChevronsUp className="size-4" /> : null}
        {installLabel}
        <ArrowRight className="size-4" />
      </NavLink>
      <button
        type="button"
        onClick={onCopyClick}
        className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-border-2 bg-card px-6 py-3 font-semibold text-[14px] text-ink transition hover:border-border-strong sm:flex-none"
      >
        <ClipboardCopy className="size-4" />
        {copyLabel}
      </button>
    </div>
  )
}
