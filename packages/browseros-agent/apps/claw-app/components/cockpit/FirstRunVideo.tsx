/**
 * @license
 * Copyright 2026 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Renders the ~20-second cockpit first-run motion demo. Ships as a
 * pre-rendered MP4 in `public/onboarding/` produced by the Remotion
 * pipeline in `@browseros/onboarding-video` (`bun run render` in
 * that workspace). At runtime the video plays via a native
 * `<video autoplay muted loop playsinline>` element, which Chromium
 * allows without user gesture as long as `muted` is set.
 *
 * Reduced-motion readers see the poster PNG (rendered from frame 0
 * of the composition) instead of the moving video.
 *
 * When the composition source changes, re-run
 *   cd packages/onboarding-video && bun run render && bun run render:poster
 * and copy the outputs into `apps/claw-app/public/onboarding/`.
 */

import { useEffect, useRef, useState } from 'react'

const VIDEO_SRC = '/onboarding/first-run-demo.mp4'
const POSTER_SRC = '/onboarding/first-run-demo-poster.png'

export function FirstRunVideo() {
  const reducedMotion = usePrefersReducedMotion()
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    if (reducedMotion) return
    // Native <video> with muted + autoplay is allowed by every
    // major browser without a user gesture, but tab throttling or
    // an unlucky race between mount and asset arrival can leave the
    // element paused. Kick play() explicitly to close the gap.
    const el = ref.current
    if (!el) return
    void el.play().catch(() => {
      // Blocked or errored; the poster stays visible until the
      // reader interacts. A rare edge case in practice.
    })
  }, [reducedMotion])
  if (reducedMotion) {
    return (
      <img
        src={POSTER_SRC}
        alt=""
        aria-hidden
        className="aspect-video w-full select-none overflow-hidden rounded-2xl border border-border-2 bg-bg-sunken object-contain"
      />
    )
  }
  return (
    <video
      ref={ref}
      src={VIDEO_SRC}
      poster={POSTER_SRC}
      autoPlay
      muted
      loop
      playsInline
      controls={false}
      disablePictureInPicture
      aria-label="A short motion demo showing how BrowserClaw works: install the MCP, prompt your agent, watch the run land in this cockpit."
      className="pointer-events-none aspect-video w-full select-none overflow-hidden rounded-2xl border border-border-2 bg-bg-sunken object-contain"
    />
  )
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    if (
      typeof window === 'undefined' ||
      typeof window.matchMedia !== 'function'
    ) {
      return
    }
    const mql = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReduced(mql.matches)
    update()
    mql.addEventListener('change', update)
    return () => mql.removeEventListener('change', update)
  }, [])
  return reduced
}
