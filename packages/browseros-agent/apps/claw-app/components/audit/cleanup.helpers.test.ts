/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { describe, expect, it } from 'bun:test'
import {
  buildConfirmationPhrase,
  formatBytes,
  matchesConfirmationPhrase,
} from './cleanup.helpers'

describe('buildConfirmationPhrase', () => {
  it('produces the canonical phrase for a plural count', () => {
    expect(buildConfirmationPhrase(42, 15)).toBe(
      'delete 42 sessions older than 15 days',
    )
  })

  it('produces a singular form when count is one', () => {
    expect(buildConfirmationPhrase(1, 30)).toBe(
      'delete 1 session older than 30 days',
    )
  })

  it('rebuilds when the range changes so muscle memory cannot unlock', () => {
    // Simulate the user picking 15-day, backing out, picking 30-day.
    const a = buildConfirmationPhrase(42, 15)
    const b = buildConfirmationPhrase(18, 30)
    expect(a).not.toBe(b)
  })
})

describe('matchesConfirmationPhrase', () => {
  const phrase = 'delete 42 sessions older than 15 days'

  it('accepts an exact match', () => {
    expect(matchesConfirmationPhrase(phrase, phrase)).toBe(true)
  })

  it('rejects the empty string', () => {
    expect(matchesConfirmationPhrase('', phrase)).toBe(false)
  })

  it('rejects a near-match with different count', () => {
    expect(
      matchesConfirmationPhrase(
        'delete 41 sessions older than 15 days',
        phrase,
      ),
    ).toBe(false)
  })

  it('rejects a near-match with different threshold', () => {
    expect(
      matchesConfirmationPhrase(
        'delete 42 sessions older than 30 days',
        phrase,
      ),
    ).toBe(false)
  })

  it('is case-sensitive', () => {
    expect(matchesConfirmationPhrase(phrase.toUpperCase(), phrase)).toBe(false)
  })

  it('rejects missing words', () => {
    expect(
      matchesConfirmationPhrase('delete 42 sessions older 15 days', phrase),
    ).toBe(false)
  })

  it('trims whitespace on both sides', () => {
    expect(matchesConfirmationPhrase(`  ${phrase}\n`, phrase)).toBe(true)
  })
})

describe('formatBytes', () => {
  it('reports zero as "0 bytes"', () => {
    expect(formatBytes(0)).toBe('0 bytes')
    expect(formatBytes(-1)).toBe('0 bytes')
  })

  it('formats sub-1KB as bytes', () => {
    expect(formatBytes(512)).toBe('512 bytes')
  })

  it('formats KB with one decimal', () => {
    expect(formatBytes(2048)).toBe('2.0 KB')
  })

  it('formats MB with one decimal', () => {
    // 3.2 MB
    expect(formatBytes(3.2 * 1024 * 1024)).toBe('3.2 MB')
  })

  it('formats GB with one decimal', () => {
    expect(formatBytes(2 * 1024 * 1024 * 1024)).toBe('2.0 GB')
  })
})
