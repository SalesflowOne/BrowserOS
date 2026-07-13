/**
 * @license
 * Copyright 2026 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { logger } from '../../lib/logger'
import type { ToolGuard } from '../dispatch'

/** Rejects calls until the server is attached to a live browser session. */
export const guardBrowserConnected: ToolGuard = (call) => {
  if (call.session) return null

  logger.warn('cockpit v2 tool dispatch rejected', {
    tool: call.tool.name,
    sessionId: call.sessionId || undefined,
    reason: 'browser session not connected',
  })
  return {
    content: [
      {
        type: 'text',
        text: 'browser session not connected; the cockpit runtime has not been wired to a live Chromium yet',
      },
    ],
    isError: true,
  }
}
