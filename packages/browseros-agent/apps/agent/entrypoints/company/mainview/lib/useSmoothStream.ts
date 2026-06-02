import { useEffect, useState } from 'react'

interface Options {
  // When false, smoothing is bypassed and `target` is returned as-is.
  // Use for completed/static text — history bubbles, ended turns.
  active?: boolean
  // Per-animation-frame reveal rate. The server hands us ~100 chars
  // every ~250ms ≈ 400 chars/sec. 4 chars/frame at 60fps ≈ 240
  // chars/sec — comfortably under the server rate so the typewriter
  // feels relaxed rather than racing. The prefix progressively falls
  // behind during a long reply, but `maxLag` caps that and snaps if
  // it ever gets uncomfortably visible.
  charsPerFrame?: number
  // If target jumps far ahead of revealed (history loaded as one
  // block, the model produces a giant chunk after a stall, or the
  // slower reveal accumulates lag during a long reply), skip the
  // typewriter and snap straight to target rather than fall multiple
  // sentences behind.
  maxLag?: number
}

/**
 * Smooths a chunky text stream into a per-frame typewriter reveal.
 *
 * The BrowserClaw server forwards model output in 75-150 char
 * blocks every ~250ms (ACP wrapper batching, can't change from the
 * client). Without smoothing each block lands in the DOM all at once
 * → text appears in abrupt steps and the scroll jumps 3-4 lines per
 * tick.
 *
 * With this hook the parent reads the smoothed prefix instead of the
 * raw target, so the DOM grows a few chars per frame and the scroll
 * + reveal both feel continuous. Internally a single
 * `requestAnimationFrame` loop ticks until the prefix catches up to
 * `target`, then idles until `target` grows again.
 *
 * Pass `active=false` for completed/static bubbles so they render
 * their full text on mount with no scheduled work.
 */
export function useSmoothStream(
  target: string,
  { active = true, charsPerFrame = 4, maxLag = 1200 }: Options = {},
): string {
  // First-paint behaviour:
  // - active=false → render the whole text immediately (history)
  // - active=true → start from empty so the typewriter is visible
  //   for the first chunk too, not just subsequent ones
  const [revealed, setRevealed] = useState(active ? '' : target)

  useEffect(() => {
    if (!active) {
      setRevealed((prev) => (prev === target ? prev : target))
      return
    }
    let cancelled = false
    let rafId: number | null = null

    const tick = () => {
      rafId = null
      if (cancelled) return
      setRevealed((prev) => {
        if (prev.length >= target.length) return prev
        if (target.length - prev.length > maxLag) return target
        const nextLen = Math.min(prev.length + charsPerFrame, target.length)
        if (nextLen < target.length) {
          rafId = requestAnimationFrame(tick)
        }
        return target.slice(0, nextLen)
      })
    }

    rafId = requestAnimationFrame(tick)
    return () => {
      cancelled = true
      if (rafId !== null) cancelAnimationFrame(rafId)
    }
  }, [target, active, charsPerFrame, maxLag])

  return revealed
}
