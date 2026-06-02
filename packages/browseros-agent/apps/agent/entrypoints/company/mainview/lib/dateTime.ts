import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'

// `relativeTime` powers dayjs's `fromNow` / `from`, used by
// `formatRelativeLong` for prose like "5 minutes ago". Idempotent on
// re-extend.
dayjs.extend(relativeTime)

// Friendly prose for any "when was this?" cell. Returns a complete
// phrase: 'a few seconds ago', '5 minutes ago', '23 hours ago', 'a
// year ago'. Do NOT append ' ago' at the call site; the helper
// already includes it.
//
// Prose stays in dayjs's built-in English locale (no `dayjs.locale()`
// call). Chat content is English-language, so this matches the
// surrounding voice; the absolute formatters below pick up the user's
// OS locale separately for the timestamps that need it.
export function formatRelativeLong(
  ts: number,
  now: number = Date.now(),
): string {
  return dayjs(ts).from(dayjs(now))
}

// Absolute formatters defer to `Intl.DateTimeFormat(undefined, ...)`
// so the user's OS locale + timezone drive the output. Earlier
// versions of this file used dayjs `lll` / `ll` / `LT` tokens, which
// silently dropped OS-locale awareness because dayjs defaults to
// English and we don't load other locale chunks. The Intl APIs are
// the cheapest way to keep "27 mai 2026" / "19:31" working for
// non-English users without lazy-loading dayjs locales.

const dateTimeFmt = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
})

const dateFmt = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
})

const timeFmt = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
})

// Locale-aware absolute date + time. Used by surfaces that want an
// absolute reference alongside the relative one (search palette
// result rows, channel transcript hover, etc.).
export function formatAbsoluteDateTime(ts: number): string {
  return dateTimeFmt.format(new Date(ts))
}

// Date only, locale-aware. Used for rows where the time of day is
// noise: "Hired on May 27, 2026".
export function formatAbsoluteDate(ts: number): string {
  return dateFmt.format(new Date(ts))
}

// Time of day only, locale-aware. Used by the per-turn clock badge in
// the chat surface.
export function formatClockTime(ts: number): string {
  return timeFmt.format(new Date(ts))
}
