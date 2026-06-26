/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * react-query-kit mutation backing the homepage's Stop button. Hits
 * `POST /agents/:agentId/cancel`; the server aborts every in-flight
 * tool dispatch across all of this agent's MCP sessions and reports
 * the count. The session stays open; the agent's harness sees the
 * cancelled dispatch as an isError tool result and is free to fire
 * its next call.
 */

import { createMutation } from 'react-query-kit'
import { api } from './client'
import { parseResponse } from './parseResponse'

export interface CancelAgentResult {
  ok: boolean
  cancelled: number
  reason?: string
}

interface CancelAgentVariables {
  agentId: string
}

export const useCancelAgent = createMutation<
  CancelAgentResult,
  CancelAgentVariables
>({
  mutationFn: async ({ agentId }) => {
    const response = await api.agents[':agentId'].cancel.$post({
      param: { agentId },
    })
    return parseResponse<CancelAgentResult>(response)
  },
})
