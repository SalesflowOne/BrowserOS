/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Post-navigate hint: appends the calling agent's recipe filenames
 * for the destination host to the tool result so the LLM reads them
 * before acting on the site. Runtime half of the browser-harness
 * "domain skills" convention (helpers.py:130-135 in the upstream),
 * ported to a NamedToolEffect on the BrowserClaw dispatch loop.
 *
 * Feature-flagged via BROWSERCLAW_RECIPES. When off, the effect is a
 * cheap early-return; no filesystem I/O happens.
 *
 * Ordering. Runs BEFORE `applyAudit` so the annotation lands in the
 * dispatch's `resultMeta` record and the operator can see, per row,
 * which recipes an agent was told about. Must run AFTER
 * `applyTabsListView` because that effect rewrites tabs-list results
 * wholesale; being downstream of it also means we never touch a
 * tabs-list dispatch (we only fire on `navigate`).
 */

import { env } from '../../env'
import { logger } from '../../lib/logger'
import {
  hostStemFromUrl,
  listRecipeFiles,
  recipesDirFor,
} from '../../services/recipes'
import type { ToolEffect } from '../dispatch'

const HINT_HEADER = 'BrowserClaw domain recipes for this host'

/**
 * Pulls the destination URL for a `navigate` dispatch out of the
 * result's `structuredContent.url` (preferred, because the tool has
 * already resolved redirects) or falls back to the args when the
 * structured field is absent. Returns null for any non-navigate call
 * so the effect can early-return without other checks.
 */
function extractNavigateUrl(
  toolName: string,
  args: unknown,
  structured: unknown,
): string | null {
  if (toolName !== 'navigate') return null
  const fromResult =
    structured &&
    typeof structured === 'object' &&
    'url' in structured &&
    typeof (structured as { url: unknown }).url === 'string'
      ? (structured as { url: string }).url
      : null
  if (fromResult) return fromResult
  const fromArgs =
    args && typeof args === 'object' && 'url' in args
      ? (args as { url: unknown }).url
      : null
  return typeof fromArgs === 'string' ? fromArgs : null
}

/** Attaches per-host recipe filenames + workspace dir to navigate results. */
export const applyDomainSkillsHint: ToolEffect = ({ call, result }) => {
  if (!env.recipesEnabled) return
  if (result.isError) return

  const url = extractNavigateUrl(
    call.tool.name,
    call.args,
    result.structuredContent,
  )
  if (!url) return
  const hostStem = hostStemFromUrl(url)
  if (!hostStem) return
  if (!call.identity) return

  const slug = call.identity.slug
  const filenames = listRecipeFiles(slug, hostStem)
  const workspaceDir = recipesDirFor(slug, hostStem)

  // Build the annotation for `structuredContent` (used by clients that
  // read structured tool output).
  const structuredIn =
    result.structuredContent && typeof result.structuredContent === 'object'
      ? (result.structuredContent as Record<string, unknown>)
      : {}
  const nextStructured = {
    ...structuredIn,
    domain_skills: {
      workspace_dir: workspaceDir,
      files: filenames,
    },
  }

  // Also append a synthetic text block: older / minimal clients that
  // only pass `content[]` to the LLM still get the hint. Duplication
  // is intentional and cheap.
  const noticeText =
    filenames.length > 0
      ? `${HINT_HEADER}: ${filenames.join(', ')}. Read each Markdown file at ${workspaceDir} using your Read tool BEFORE acting on this site. Save new recipes to the same directory when you discover something non-obvious.`
      : `${HINT_HEADER}: none yet. Save your discoveries as .md files under ${workspaceDir} using your Write tool so future agents skip your discovery pain.`
  const nextContent = [
    ...result.content,
    { type: 'text' as const, text: noticeText },
  ]

  logger.debug('recipes surfaced on navigate', {
    slug,
    hostStem,
    count: filenames.length,
  })

  return {
    ...result,
    content: nextContent,
    structuredContent: nextStructured,
  }
}
