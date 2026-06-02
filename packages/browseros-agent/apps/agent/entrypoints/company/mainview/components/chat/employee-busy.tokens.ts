// Rough OpenAI-style heuristic: ~4 chars per token for English.
// Pessimistic on code-heavy content, optimistic on whitespace. Good
// enough for an at-a-glance indicator. Do NOT use for billing or
// quota math.
const CHARS_PER_TOKEN = 4

export function approxTokensFromChars(chars: number): number {
  if (chars <= 0) return 0
  return Math.ceil(chars / CHARS_PER_TOKEN)
}

// Compact formatter that keeps the EmployeeBusy row inside its width
// budget once token counts climb past 1k. 1234 → "1.2K", 12345 → "12K".
export function formatTokenCount(n: number): string {
  if (n < 1000) return String(n)
  const k = n / 1000
  // Branch on the post-rounding value, not the raw input: toFixed(1)
  // can carry a 9.96+ value up to "10.0", which would render as
  // "10.0K" instead of "10K" if we keyed the format off `n` alone.
  const rounded1dp = Math.round(k * 10) / 10
  return rounded1dp < 10 ? `${k.toFixed(1)}K` : `${Math.round(k)}K`
}

// Elapsed-time formatter that switches from `Ns` to `Nm SSs` past 60s so
// the column doesn't run away on long tool loops. Floors fractional
// seconds; clamps negative inputs (clock drift on replay) to 0.
export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const rem = s % 60
  return `${m}m ${String(rem).padStart(2, '0')}s`
}
