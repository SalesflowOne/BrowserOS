/**
 * @license
 * Copyright 2026 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { ensureAgentTabGroup } from '../../services/tab-group-ops'
import type { ToolEffect } from '../dispatch'

/** Starts tab-group placement after a successful tabs-new dispatch. */
export const applyTabGroups: ToolEffect = ({ call, result }) => {
  if (result.isError || !call.flags.newPage || !call.agent || !call.session) {
    return undefined
  }
  const pageId = (result.structuredContent as { page?: number } | undefined)
    ?.page
  if (typeof pageId !== 'number') return undefined
  void ensureAgentTabGroup({
    agentId: call.agent.agentId,
    slug: call.agent.slug,
    pageId,
    session: call.session,
    signal: call.signal,
  })
  return undefined
}
