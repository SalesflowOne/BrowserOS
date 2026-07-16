/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Helpers for the audit cleanup dialog. Two responsibilities:
 *
 *   1. Format the bytes+session sub-line the user sees on each radio.
 *   2. Build the typed-confirmation phrase and check whether the user's
 *      input matches it. Case-sensitive, whitespace-trimmed exact match.
 *      Anything looser (case-insensitive, fuzzy) defeats the point of
 *      the gate: the phrase exists to force conscious reading, not to
 *      be another checkbox.
 */

/**
 * Builds the typed-confirmation phrase for a given cleanup range. The
 * phrase mirrors the read-back line above the input so the user's
 * fingers acknowledge exactly what will happen. It rebuilds when the
 * radio selection changes, so muscle memory from a previous cleanup
 * cannot unlock a new one.
 */
export function buildConfirmationPhrase(
  sessionCount: number,
  olderThanDays: number,
): string {
  return `delete ${sessionCount} ${sessionCount === 1 ? 'session' : 'sessions'} older than ${olderThanDays} days`
}

/**
 * Exact, case-sensitive comparator with whitespace trimmed on both
 * sides. Paste (Cmd+V) counts as a match because the friction we care
 * about is READING the phrase, not typing each character. But everything
 * about the phrase itself has to be right: character-for-character.
 */
export function matchesConfirmationPhrase(
  input: string,
  expected: string,
): boolean {
  return input.trim() === expected.trim()
}

/**
 * Bytes -> short human string. Zero collapses to "0 bytes"; anything
 * under 1024 shows as bytes; otherwise KB / MB / GB with one decimal.
 * Deliberately imprecise on purpose: the value is a "up to" estimate,
 * not a promise.
 */
export function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 bytes'
  if (bytes < 1024) return `${bytes} bytes`
  const kb = bytes / 1024
  if (kb < 1024) return `${kb.toFixed(1)} KB`
  const mb = kb / 1024
  if (mb < 1024) return `${mb.toFixed(1)} MB`
  const gb = mb / 1024
  return `${gb.toFixed(1)} GB`
}
