/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Per-agent per-host recipe file store. Files live at
 *   <browserclawDir>/recipes/<slug>/<host-stem>/<name>.md
 *
 * The runtime surfacing lives in the `domain-skills-hint` dispatch
 * effect; this file only owns pure path derivation + directory reads.
 * Writes are the agent's job (it uses its coding-agent's own Write
 * tool).
 */

import { readdirSync, statSync } from 'node:fs'
import { resolveClawServerPath } from '../lib/browserclaw-dir'

export const RECIPES_DIR_NAME = 'recipes'
export const RECIPE_FILE_EXTENSION = '.md'
/**
 * Cap on how many filenames surface on a single navigate. Ten is
 * enough context for the LLM without flooding the tool result.
 */
export const MAX_SKILLS_SURFACED = 10

/**
 * Reduce a URL to a hostname stem: strip a leading `www.`, then take
 * the first dot-separated label. `mail.google.com` yields `mail`, not
 * `google`, so subdomains get their own recipe folder.
 *
 * Returns null for URLs without an http(s) hostname (e.g.
 * `chrome://newtab`, `about:blank`, `file:///`, malformed strings).
 * Callers treat null as "no recipes for this navigation" and
 * short-circuit.
 */
export function hostStemFromUrl(url: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  // Recipes only make sense for real websites. Filter out chrome://,
  // about:, file:, data: etc. so a `chrome://newtab` navigation does
  // not create a `newtab` recipe folder.
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
  const host = parsed.hostname
  if (!host) return null
  const noWww = host.replace(/^www\./, '')
  const stem = noWww.split('.')[0]
  return stem && stem.length > 0 ? stem : null
}

export function recipesDirFor(slug: string, hostStem: string): string {
  return resolveClawServerPath(RECIPES_DIR_NAME, slug, hostStem)
}

/**
 * Filenames (not full paths) of recipe files for the given agent slug
 * and host stem, sorted, capped at MAX_SKILLS_SURFACED. Missing
 * directory is not an error; it just means no recipes yet. Never
 * throws so the dispatch effect that calls this can be non-fatal.
 */
export function listRecipeFiles(slug: string, hostStem: string): string[] {
  const dir = recipesDirFor(slug, hostStem)
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return []
  }
  const out: string[] = []
  for (const entry of entries) {
    if (!entry.endsWith(RECIPE_FILE_EXTENSION)) continue
    // Guard against the file vanishing between readdir and stat, and
    // against non-file entries (subdirs, sockets) sneaking in.
    try {
      if (!statSync(`${dir}/${entry}`).isFile()) continue
    } catch {
      continue
    }
    out.push(entry)
  }
  return out.sort().slice(0, MAX_SKILLS_SURFACED)
}
