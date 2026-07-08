/**
 * @license
 * Copyright 2026 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { useEffect, useRef, useState } from 'react'

const CDN_BASE_URL = 'https://cdn.browseros.com'
const ASSET_VERSION = '0.2.0'
const ASSET_BASE = `${CDN_BASE_URL}/artifacts/claw/onboarding-video/v${ASSET_VERSION}`
const VIDEO_SRC = `${ASSET_BASE}/first-run-demo.mp4`
const POSTER_SRC = `${ASSET_BASE}/first-run-demo-poster.png`

export function FirstRunVideo() {
  const reducedMotion = usePrefersReducedMotion()
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    if (reducedMotion) return
    const el = ref.current
    if (!el) return
    void el.play().catch(() => undefined)
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
      preload="auto"
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
