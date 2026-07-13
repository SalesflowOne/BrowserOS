/**
 * @license
 * Copyright 2026 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { agentTabs } from '../../lib/agent-tabs'
import { identityService } from '../../lib/mcp-session'
import type { ToolEffect } from '../dispatch'
import {
  annotateTabsListWithOwnership,
  buildOwnershipDeps,
} from '../tabs-ownership'

/** Replaces successful tabs-list results with the caller's ownership view. */
export const applyTabsListView: ToolEffect = ({ call, result }) => {
  if (result.isError || !call.flags.listTabs || !call.identity) return
  const deps = buildOwnershipDeps(call.identity, agentTabs, identityService)
  return annotateTabsListWithOwnership(result, deps)
}
