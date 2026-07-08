/**
 * @license
 * Copyright 2026 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * A small "MCP" packet that travels from the agent terminal to the
 * cockpit landing-dot. Rendered as an absolutely-positioned pill on
 * top of both surfaces; scene supplies the frame-driven x/y.
 */

import { palette } from '../palette'

interface ConnectorPacketProps {
  /** 0 to 1 progress along the path. */
  progress: number
  /** Screen-space start and end points (px). */
  from: { x: number; y: number }
  to: { x: number; y: number }
  opacity?: number
}

export function ConnectorPacket({
  progress,
  from,
  to,
  opacity = 1,
}: ConnectorPacketProps) {
  const x = from.x + (to.x - from.x) * progress
  const y = from.y + (to.y - from.y) * progress
  // Slight arc so the packet does not travel in a boring straight line.
  const arc = Math.sin(progress * Math.PI) * -40
  return (
    <div
      style={{
        position: 'absolute',
        left: x - 34,
        top: y + arc - 14,
        opacity,
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 12px',
        borderRadius: 999,
        background: palette.accent,
        color: palette.card,
        fontFamily: '"JetBrains Mono", monospace',
        fontSize: 11,
        letterSpacing: 1.2,
        fontWeight: 700,
        boxShadow: '0 12px 30px -10px rgba(2, 84, 236, 0.6)',
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: 999,
          background: palette.card,
        }}
      />
      MCP
    </div>
  )
}
