import { Globe } from 'lucide-react'
import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { useTabPreviewUrl } from '@/modules/api/tabs.hooks'

interface MiniScreencastProps {
  site: string
  live?: boolean
  pageId: number
  previewCapturedAt?: number
  className?: string
}

/**
 * Live card preview backed by the canonical binary JPEG route. The capture
 * timestamp changes the URL for each frame while `displayedSrc` keeps the old
 * decoded image painted until its replacement is ready.
 */
export function MiniScreencast({
  site,
  live,
  pageId,
  previewCapturedAt,
  className,
}: MiniScreencastProps) {
  const incomingSrc = useTabPreviewUrl(pageId, previewCapturedAt)
  const [displayedSrc, setDisplayedSrc] = useState<string | null>(incomingSrc)

  useEffect(() => {
    if (incomingSrc === null) {
      setDisplayedSrc(null)
      return
    }
    if (incomingSrc === displayedSrc) return
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
            'ring-2 ring-bg-canvas/70',
          )}
        />
      )}
    </div>
  )
}
