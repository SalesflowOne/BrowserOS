/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Session-scoped cancellation for the cockpit Stop action.
 */

import type { CancelSessionResponse } from '@browseros/claw-api'
import { createMutation } from 'react-query-kit'
import { apiClient } from './client'

export const useCancelSession = createMutation<
  CancelSessionResponse,
  { sessionId: string }
>({
  mutationFn: async ({ sessionId }) =>
    (await apiClient()).cancelSession({ sessionId }),
})
