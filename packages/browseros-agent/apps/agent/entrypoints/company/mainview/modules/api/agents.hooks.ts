import type { InferResponseType } from 'hono/client'
import { createQuery } from 'react-query-kit'
import { api } from './client'
import { parseResponse } from './parseResponse'

const $available = api.agents.available.$get

export type AgentDetection = InferResponseType<typeof $available>[number]

export const useAvailableAgents = createQuery<AgentDetection[]>({
  queryKey: ['agents', 'available'],
  fetcher: () => $available().then(parseResponse<AgentDetection[]>),
  // Re-detect every time something mounts the hook (e.g. the Hire dialog
  // opens) so the picker reflects agents the founder installed since the
  // app launched. The underlying probes are cheap.
  staleTime: 0,
  refetchOnMount: 'always',
})
