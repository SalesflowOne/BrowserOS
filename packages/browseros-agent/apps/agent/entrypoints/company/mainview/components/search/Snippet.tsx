import type { FC } from 'react'

interface Props {
  text: string
  query: string
  // Total chars of context around the match. Tuned to fit the
  // CommandItem row width at our default font size.
  windowSize?: number
  className?: string
}

// Case-insensitive single-match clip. Returns a span with the matched
// substring wrapped in <mark> styled with the accent-orange highlight
// the rest of the app uses for "important right now" states. If the
// query isn't found (race between debounce + cache), falls back to a
// plain head-of-string clip.
export const Snippet: FC<Props> = ({
  text,
  query,
  windowSize = 120,
  className,
}) => {
  if (!text || !query) {
    return (
      <span className={className}>
        {text.slice(0, windowSize)}
        {text.length > windowSize ? '…' : ''}
      </span>
    )
  }
  const idx = text.toLowerCase().indexOf(query.toLowerCase())
  if (idx < 0) {
    return (
      <span className={className}>
        {text.slice(0, windowSize)}
        {text.length > windowSize ? '…' : ''}
      </span>
    )
  }
  const half = Math.max(0, Math.floor((windowSize - query.length) / 2))
  const start = Math.max(0, idx - half)
  const end = Math.min(text.length, idx + query.length + half)
  const before = text.slice(start, idx)
  const match = text.slice(idx, idx + query.length)
  const after = text.slice(idx + query.length, end)
  return (
    <span className={className}>
      {start > 0 ? '…' : ''}
      {before}
      <mark className="rounded bg-[color:var(--accent-orange)]/20 px-0.5 font-medium text-foreground">
        {match}
      </mark>
      {after}
      {end < text.length ? '…' : ''}
    </span>
  )
}
