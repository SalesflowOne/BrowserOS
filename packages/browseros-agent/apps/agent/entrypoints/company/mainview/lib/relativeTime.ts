// Short-form relative time for the sidebar (max 3 chars where possible).
// Bucketed so the rail stays visually steady — exact seconds don't matter,
// the founder just needs an at-a-glance recency cue.

const SHORT_DATE_FMT = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
})

const MIN = 60_000
const HR = 60 * MIN
const DAY = 24 * HR
const WEEK = 7 * DAY
// Use 30-day months and 365-day years to keep bucket boundaries
// deterministic — the rail re-renders every minute, drift from real
// calendar months is invisible at this granularity.
const MONTH = 30 * DAY
const YEAR = 365 * DAY

export function formatRelativeShort(
  ts: number,
  now: number = Date.now(),
): string {
  const diff = now - ts
  if (diff < MIN) return 'just'
  if (diff < HR) return `${Math.floor(diff / MIN)}m`
  if (diff < DAY) return `${Math.floor(diff / HR)}h`
  if (diff < WEEK) return `${Math.floor(diff / DAY)}d`
  if (diff < MONTH) return `${Math.floor(diff / WEEK)}w`
  if (diff < YEAR) return `${Math.floor(diff / MONTH)}mo`
  return SHORT_DATE_FMT.format(new Date(ts))
}
