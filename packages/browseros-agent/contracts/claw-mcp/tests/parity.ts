/**
 * Cross-server parity ledger. Cases record semantic signatures —
 * extracted (role, name, ref) sets, error classes, spill flags — under
 * stable keys while each server runs; after both passes the parity
 * gate compares every key recorded by both servers. Keys tagged with a
 * divergence id are exempt from equality but must point at a
 * registered divergence, so the suite fails on NEW divergences only.
 */

import { getDivergence } from './divergences'
import type { ServerName } from './server-adapters'

interface ParityEntry {
  values: Partial<Record<ServerName, unknown>>
  divergence?: string
}

const ledger = new Map<string, ParityEntry>()

export function recordSignature(
  key: string,
  server: ServerName,
  value: unknown,
  options: { divergence?: string } = {},
): void {
  const entry = ledger.get(key) ?? { values: {} }
  entry.values[server] = value
  if (options.divergence) {
    getDivergence(options.divergence)
    entry.divergence = options.divergence
  }
  ledger.set(key, entry)
}

export function assertParity(): void {
  const failures: string[] = []
  for (const [key, entry] of ledger) {
    const { rust, typescript } = entry.values
    if (rust === undefined || typescript === undefined) continue
    if (entry.divergence) continue
    if (!Bun.deepEquals(rust, typescript, true)) {
      failures.push(
        [
          `parity mismatch on "${key}":`,
          `  typescript: ${JSON.stringify(typescript)}`,
          `  rust:       ${JSON.stringify(rust)}`,
        ].join('\n'),
      )
    }
  }
  if (failures.length > 0) {
    throw new Error(
      `${failures.length} NEW cross-server divergence(s) — fix the drifting server, or (if the difference is intended) register it in divergences.ts + DIVERGENCES.md and tag the recording:\n\n${failures.join('\n\n')}`,
    )
  }
}

export function comparedKeyCount(): number {
  let count = 0
  for (const entry of ledger.values()) {
    if (
      entry.values.rust !== undefined &&
      entry.values.typescript !== undefined
    ) {
      count += 1
    }
  }
  return count
}

/**
 * Semantic signature of a rendered snapshot: the sorted (role, name)
 * pairs of every line that minted a ref. Ref numbers and layout are
 * implementation detail; the set of interactive elements is contract.
 */
export function axSignature(snapshotText: string): string[] {
  const signature = new Set<string>()
  for (const line of snapshotText.split('\n')) {
    if (!line.includes('[ref=')) continue
    const match = line.match(/-\s+(\w+)(?:\s+"([^"]*)")?/)
    if (match) signature.add(`${match[1]}|${match[2] ?? ''}`)
  }
  return [...signature].sort()
}

const ERROR_CLASSES: Array<[string, RegExp]> = [
  ['stale-ref', /stale ref .*take a new snapshot/i],
  ['unknown-ref', /unknown ref .*take a new snapshot/i],
  ['gone-element', /not found in dom.*take a new snapshot/i],
  ['not-owned', /is (not )?owned by .*tabs new/i],
  // The polished start-BrowserClaw guard fires when the browser is
  // unreachable at boot; a browser that dies mid-session surfaces the
  // lower-level "CDP not connected" instead (verified on both servers).
  [
    'browser-down',
    /(browser session not connected.*start BrowserClaw|cdp not connected|not running or paired)/is,
  ],
  ['scheme-refused', /navigate refuses .* URLs; only http\(s\) is allowed/i],
]

/** Buckets an error text into a stable cross-server class. */
export function errorClass(text: string): string {
  for (const [name, pattern] of ERROR_CLASSES) {
    if (pattern.test(text)) return name
  }
  return `other:${text.slice(0, 60).toLowerCase()}`
}
