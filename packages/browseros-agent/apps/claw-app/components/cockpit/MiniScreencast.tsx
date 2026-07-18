import { Globe } from 'lucide-react'
import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { useTabPreviewUrl } from '@/modules/api/tabs.hooks'

interface MiniScreencastProps {
  site: string
  live?: boolean
  pageId: number
  /**
   * Timestamp of the tab's newest capture. Its only job here is to make
   * the preview URL unique per frame; undefined means the tab has never
   * been captured, which renders the globe placeholder.
   */
  previewCapturedAt?: number
  /**
   * Overrides the container sizing. Defaults to `h-[132px] w-full` for
   * compact cards; AgentRunningCard passes `h-full w-full` so the frame
   * fills its `flex-1` zone instead of clamping at 132px.
   */
  className?: string
}

/**
 * Card-top tile on the Running-now homepage cards. Renders the tab's
 * latest capture from the canonical binary JPEG route; falls back to a
 * tinted block with the site host and a small globe while there is no
 * frame to show.
 *
 * Flicker-free frame swap: every `previewCapturedAt` tick yields a new
 * preview URL, and swapping the visible `<img src>` directly would
 * unload the old pixels the moment the attribute changes, briefly
 * exposing the container backdrop between paints — the operator sees
 * that as a flicker on every poll. So an off-screen `new Image()`
 * fetches and decodes the next frame first, and `displayedSrc` only
 * advances once the decode completes; the visible swap then hits the
 * browser cache and paints without a gap.
 *
 * The `live` flag adds a pulsing dot top-right matching the design's
 * running indicator.
 */
export function MiniScreencast({
  site,
  live,
  pageId,
  previewCapturedAt,
  className,
}: MiniScreencastProps) {
  const incomingSrc = useTabPreviewUrl(pageId, previewCapturedAt)
  // `displayedSrc` is the src actually painted in the DOM. It only
  // moves forward once the new frame has decoded successfully.
  const [displayedSrc, setDisplayedSrc] = useState<string | null>(incomingSrc)

  useEffect(() => {
    if (incomingSrc === null) {
      setDisplayedSrc(null)
      return
    }
    if (incomingSrc === displayedSrc) return
    // Pre-decode off-screen; if the fetch or decode fails, onload never
    // fires and the previous frame stays painted until the next capture.
    let cancelled = false
    const image = new Image()
    image.onload = () => {
      if (!cancelled) setDisplayedSrc(incomingSrc)
    }
    image.src = incomingSrc
    return () => {
      cancelled = true
    }
  }, [incomingSrc, displayedSrc])

  return (
    <div
      className={cn(
        'relative flex items-center justify-center overflow-hidden bg-bg-sunken',
        className ?? 'h-[132px] w-full',
      )}
    >
      {displayedSrc ? (
        <img
          src={displayedSrc}
          alt={`Live view of ${site}`}
          className="h-full w-full object-cover"
          // Catches bad bytes that slipped past the pre-decode gate
          // (mainly on mount, where displayedSrc seeds straight from
          // incomingSrc). Nulling falls back to the globe placeholder
          // instead of the browser's broken-image icon.
          onError={() => setDisplayedSrc(null)}
        />
      ) : (
        <div className="flex flex-col items-center gap-1.5 text-ink-3">
          <Globe className="size-7" />
          <code className="font-mono text-[11px] text-ink-2">{site}</code>
        </div>
      )}
      {live && (
        <span
          aria-hidden
          className={cn(
            'absolute top-2.5 right-2.5 size-2 animate-pulse-dot rounded-full bg-green',
            // Translucent ring so the dot stays readable against busy
            // live thumbnails.
            'ring-2 ring-bg-canvas/70',
          )}
        />
      )}
    </div>
  )
}
