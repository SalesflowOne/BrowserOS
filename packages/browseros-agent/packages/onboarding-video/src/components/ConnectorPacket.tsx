/**
 * @license
 * Copyright 2026 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * The MCP connector: a curved arrow drawn from the agent terminal
 * to the cockpit landing-dot with an "MCP" pill anchored on the
 * curve. The arrow shape makes the direction of communication
 * legible: the agent (right) speaks to the browser (left) via MCP.
 * `progress` fades the whole arrow in during the packet-fly phase;
 * `opacity` handles the outer fade-out at the end of the scene.
 */

import { palette } from '../palette'

interface ConnectorPacketProps {
  /** 0 to 1: overall arrow fade-in during the packet phase. */
  progress: number
  /** Screen-space start (terminal side). */
  from: { x: number; y: number }
  /** Screen-space end (cockpit landing-dot). */
  to: { x: number; y: number }
  /** Overall element opacity for the outer fade-out. */
  opacity?: number
}

const STROKE_WIDTH = 6
const ARROWHEAD_ID = 'mcp-arrowhead'

export function ConnectorPacket({
  progress,
  from,
  to,
  opacity = 1,
}: ConnectorPacketProps) {
  // Cubic Bezier: an arc lifted above the direct line so the arrow
  // reads clearly against the cockpit + terminal chrome.
  const dx = to.x - from.x
  const arcRise = -140
  const cp1 = { x: from.x + dx * 0.35, y: from.y + arcRise }
  const cp2 = { x: from.x + dx * 0.65, y: to.y + arcRise }
  const pathD = `M ${from.x} ${from.y} C ${cp1.x} ${cp1.y}, ${cp2.x} ${cp2.y}, ${to.x} ${to.y}`

  // Cubic Bezier position at parameter t (0.5 is the visual apex).
  const t = 0.5
  const labelPos = cubicBezier(t, from, cp1, cp2, to)

  // Fade the whole arrow in over the first 40% of `progress`, hold
  // the rest so the reader has plenty of time to parse the shape.
  const fadeIn = progress <= 0 ? 0 : progress >= 0.4 ? 1 : progress / 0.4

  return (
    <svg
      // biome-ignore lint/a11y/noSvgWithoutTitle: decorative arrow inside a video composition
      role="presentation"
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        opacity: opacity * fadeIn,
        pointerEvents: 'none',
      }}
      viewBox="0 0 1600 900"
      preserveAspectRatio="none"
    >
      <defs>
        <marker
          id={ARROWHEAD_ID}
          viewBox="0 0 12 12"
          refX="10"
          refY="6"
          markerWidth="10"
          markerHeight="10"
          orient="auto-start-reverse"
          markerUnits="userSpaceOnUse"
        >
          <path d="M0 0 L12 6 L0 12 z" fill={palette.accent} />
        </marker>
      </defs>
      {/* The arrow: curve from terminal to cockpit with an arrowhead
       *  at `to` so the direction of flow is instantly legible. */}
      <path
        d={pathD}
        stroke={palette.accent}
        strokeWidth={STROKE_WIDTH}
        strokeLinecap="round"
        fill="none"
        markerEnd={`url(#${ARROWHEAD_ID})`}
      />
      {/* MCP label pill anchored to the curve's midpoint. */}
      <g transform={`translate(${labelPos.x - 48} ${labelPos.y - 20})`}>
        <rect
          width={96}
          height={34}
          rx={17}
          fill={palette.accent}
          stroke={palette.card}
          strokeWidth={2}
        />
        <text
          x={48}
          y={23}
          fontFamily='"JetBrains Mono", monospace'
          fontSize={16}
          fontWeight={800}
          letterSpacing={2.5}
          textAnchor="middle"
          fill={palette.card}
        >
          MCP
        </text>
      </g>
    </svg>
  )
}

function cubicBezier(
  t: number,
  p0: { x: number; y: number },
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  p3: { x: number; y: number },
): { x: number; y: number } {
  const it = 1 - t
  const it2 = it * it
  const it3 = it2 * it
  const t2 = t * t
  const t3 = t2 * t
  return {
    x: it3 * p0.x + 3 * it2 * t * p1.x + 3 * it * t2 * p2.x + t3 * p3.x,
    y: it3 * p0.y + 3 * it2 * t * p1.y + 3 * it * t2 * p2.y + t3 * p3.y,
  }
}
