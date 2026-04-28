import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getAgentServerUrl } from '@/lib/browseros/helpers'
import { useAgentServerUrl } from '@/lib/browseros/useBrowserOSProviders'

export interface AgentEntry {
  agentId: string
  name: string
  workspace: string
  model?: unknown
}

export interface OpenClawStatus {
  status: 'uninitialized' | 'starting' | 'running' | 'stopped' | 'error'
  podmanAvailable: boolean
  machineReady: boolean
  port: number | null
  agentCount: number
  error: string | null
  controlPlaneStatus:
    | 'disconnected'
    | 'connecting'
    | 'connected'
    | 'reconnecting'
    | 'recovering'
    | 'failed'
  lastGatewayError: string | null
  lastRecoveryReason:
    | 'transient_disconnect'
    | 'signature_expired'
    | 'pairing_required'
    | 'token_mismatch'
    | 'container_not_ready'
    | 'unknown'
    | null
  /** Resolved global default chat model (`agents.defaults.model`). */
  defaultModel: string | null
  /** Resolved global default vision model (`agents.defaults.imageModel`). */
  defaultImageModel: string | null
}

export interface OpenClawAgentMutationInput {
  name: string
  providerType?: string
  providerName?: string
  baseUrl?: string
  apiKey?: string
  modelId?: string
}

export interface OpenClawSetupInput {
  providerType?: string
  providerName?: string
  baseUrl?: string
  apiKey?: string
  modelId?: string
  imageModelId?: string
}

export interface ResolvedAgentConfigValue {
  value: string | null
  source: 'agent' | 'default'
}

export interface AgentModelDetails {
  model: ResolvedAgentConfigValue
  imageModel: ResolvedAgentConfigValue
}

export interface UpdateAgentModelsInput {
  agentId: string
  /** Bare model id (no provider prefix). `null` clears the override. `undefined` leaves it untouched. */
  model?: string | null
  imageModel?: string | null
  providerType?: string
}

export function getModelDisplayName(model: unknown): string | undefined {
  if (typeof model === 'string') return model.split('/').pop()
  return undefined
}

export const OPENCLAW_QUERY_KEYS = {
  status: 'openclaw-status',
  agents: 'openclaw-agents',
  agentModels: 'openclaw-agent-models',
} as const

export type GatewayLifecycleAction =
  | 'setup'
  | 'start'
  | 'stop'
  | 'restart'
  | 'reconnect'

async function clawFetch<T>(
  baseUrl: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(`${baseUrl}/claw${path}`, init)
  if (!res.ok) {
    let message = `Request failed with status ${res.status}`
    try {
      const body = (await res.json()) as { error?: string }
      if (body.error) {
        message = body.error
      }
    } catch {}
    throw new Error(message)
  }
  return res.json() as Promise<T>
}

async function fetchOpenClawStatus(baseUrl: string): Promise<OpenClawStatus> {
  return clawFetch<OpenClawStatus>(baseUrl, '/status')
}

async function fetchOpenClawAgents(baseUrl: string): Promise<AgentEntry[]> {
  const data = await clawFetch<{ agents: AgentEntry[] }>(baseUrl, '/agents')
  return data.agents ?? []
}

async function invalidateOpenClawQueries(
  queryClient: ReturnType<typeof useQueryClient>,
): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: [OPENCLAW_QUERY_KEYS.status] }),
    queryClient.invalidateQueries({ queryKey: [OPENCLAW_QUERY_KEYS.agents] }),
    queryClient.invalidateQueries({
      queryKey: [OPENCLAW_QUERY_KEYS.agentModels],
    }),
  ])
}

async function fetchAgentModels(
  baseUrl: string,
  agentId: string,
): Promise<AgentModelDetails> {
  return clawFetch<AgentModelDetails>(
    baseUrl,
    `/agents/${encodeURIComponent(agentId)}/models`,
  )
}

export function useAgentModels(agentId: string, enabled = true) {
  const {
    baseUrl,
    isLoading: urlLoading,
    error: urlError,
  } = useAgentServerUrl()

  const query = useQuery<AgentModelDetails, Error>({
    queryKey: [OPENCLAW_QUERY_KEYS.agentModels, baseUrl, agentId],
    queryFn: () => fetchAgentModels(baseUrl as string, agentId),
    enabled: !!baseUrl && !urlLoading && !!agentId && enabled,
  })

  return {
    details: query.data ?? null,
    loading: query.isLoading || urlLoading,
    error: query.error ?? urlError,
    refetch: query.refetch,
  }
}

/**
 * Mutation hook for setting/clearing per-agent text + image model
 * overrides. Wires the optimistic update + rollback path the plan
 * spec requires.
 */
export function useUpdateAgentModels() {
  const { baseUrl, isLoading: urlLoading } = useAgentServerUrl()
  const queryClient = useQueryClient()

  return useMutation<
    AgentModelDetails,
    Error,
    UpdateAgentModelsInput,
    { previous: AgentModelDetails | undefined; agentId: string }
  >({
    mutationFn: async (input) => {
      if (!baseUrl || urlLoading) {
        throw new Error('BrowserOS agent server URL is not ready')
      }
      const body: Record<string, unknown> = {}
      if (input.model !== undefined) body.model = input.model
      if (input.imageModel !== undefined) body.imageModel = input.imageModel
      if (input.providerType) body.providerType = input.providerType
      const response = await clawFetch<{
        modelUpdated: boolean
        imageModelUpdated: boolean
        resolved: AgentModelDetails
      }>(baseUrl, `/agents/${encodeURIComponent(input.agentId)}/models`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      return response.resolved
    },
    onMutate: async (input) => {
      const queryKey = [OPENCLAW_QUERY_KEYS.agentModels, baseUrl, input.agentId]
      await queryClient.cancelQueries({ queryKey })
      const previous = queryClient.getQueryData<AgentModelDetails>(queryKey)
      if (previous) {
        const optimistic: AgentModelDetails = {
          model:
            input.model === undefined
              ? previous.model
              : input.model === null
                ? { value: null, source: 'default' }
                : { value: input.model, source: 'agent' },
          imageModel:
            input.imageModel === undefined
              ? previous.imageModel
              : input.imageModel === null
                ? { value: null, source: 'default' }
                : { value: input.imageModel, source: 'agent' },
        }
        queryClient.setQueryData(queryKey, optimistic)
      }
      return { previous, agentId: input.agentId }
    },
    onError: (_error, _variables, context) => {
      if (!context) return
      const queryKey = [
        OPENCLAW_QUERY_KEYS.agentModels,
        baseUrl,
        context.agentId,
      ]
      if (context.previous) {
        queryClient.setQueryData(queryKey, context.previous)
      } else {
        queryClient.removeQueries({ queryKey })
      }
    },
    onSettled: () => invalidateOpenClawQueries(queryClient),
  })
}

export function useOpenClawStatus(pollMs = 5000) {
  const {
    baseUrl,
    isLoading: urlLoading,
    error: urlError,
  } = useAgentServerUrl()

  const query = useQuery<OpenClawStatus, Error>({
    queryKey: [OPENCLAW_QUERY_KEYS.status, baseUrl],
    queryFn: () => fetchOpenClawStatus(baseUrl as string),
    enabled: !!baseUrl && !urlLoading,
    refetchInterval: pollMs,
  })

  return {
    status: query.data ?? null,
    loading: query.isLoading || urlLoading,
    error: query.error ?? urlError,
    refetch: query.refetch,
  }
}

export function useOpenClawAgents(enabled = true) {
  const {
    baseUrl,
    isLoading: urlLoading,
    error: urlError,
  } = useAgentServerUrl()

  const query = useQuery<AgentEntry[], Error>({
    queryKey: [OPENCLAW_QUERY_KEYS.agents, baseUrl],
    queryFn: () => fetchOpenClawAgents(baseUrl as string),
    enabled: !!baseUrl && !urlLoading && enabled,
  })

  return {
    agents: query.data ?? [],
    loading: query.isLoading || urlLoading,
    error: query.error ?? urlError,
    refetch: query.refetch,
  }
}

export function useOpenClawMutations() {
  const { baseUrl, isLoading: urlLoading } = useAgentServerUrl()
  const queryClient = useQueryClient()

  const ensureBaseUrl = () => {
    if (!baseUrl || urlLoading) {
      throw new Error('BrowserOS agent server URL is not ready')
    }
    return baseUrl
  }

  const onSuccess = () => invalidateOpenClawQueries(queryClient)

  const setupMutation = useMutation({
    mutationFn: async (input: OpenClawSetupInput) =>
      clawFetch<{ status: string; agents: AgentEntry[] }>(
        ensureBaseUrl(),
        '/setup',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        },
      ),
    onSuccess,
  })

  const createMutation = useMutation({
    mutationFn: async (input: OpenClawAgentMutationInput) =>
      clawFetch<{ agent: AgentEntry }>(ensureBaseUrl(), '/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      }),
    onSuccess,
  })

  const deleteMutation = useMutation({
    mutationFn: async (id: string) =>
      clawFetch<{ success: boolean }>(ensureBaseUrl(), `/agents/${id}`, {
        method: 'DELETE',
      }),
    onSuccess,
  })

  const startMutation = useMutation({
    mutationFn: async () =>
      clawFetch<{ status: string }>(ensureBaseUrl(), '/start', {
        method: 'POST',
      }),
    onSuccess,
  })

  const stopMutation = useMutation({
    mutationFn: async () =>
      clawFetch<{ status: string }>(ensureBaseUrl(), '/stop', {
        method: 'POST',
      }),
    onSuccess,
  })

  const restartMutation = useMutation({
    mutationFn: async () =>
      clawFetch<{ status: string }>(ensureBaseUrl(), '/restart', {
        method: 'POST',
      }),
    onSuccess,
  })

  const reconnectMutation = useMutation({
    mutationFn: async () =>
      clawFetch<{ status: string }>(ensureBaseUrl(), '/reconnect', {
        method: 'POST',
      }),
    onSuccess,
  })

  let pendingGatewayAction: GatewayLifecycleAction | null = null
  if (setupMutation.isPending) pendingGatewayAction = 'setup'
  else if (restartMutation.isPending) pendingGatewayAction = 'restart'
  else if (stopMutation.isPending) pendingGatewayAction = 'stop'
  else if (startMutation.isPending) pendingGatewayAction = 'start'
  else if (reconnectMutation.isPending) pendingGatewayAction = 'reconnect'

  return {
    setupOpenClaw: setupMutation.mutateAsync,
    createAgent: createMutation.mutateAsync,
    deleteAgent: deleteMutation.mutateAsync,
    startOpenClaw: startMutation.mutateAsync,
    stopOpenClaw: stopMutation.mutateAsync,
    restartOpenClaw: restartMutation.mutateAsync,
    reconnectOpenClaw: reconnectMutation.mutateAsync,
    actionInProgress:
      setupMutation.isPending ||
      createMutation.isPending ||
      deleteMutation.isPending ||
      startMutation.isPending ||
      stopMutation.isPending ||
      restartMutation.isPending ||
      reconnectMutation.isPending,
    settingUp: setupMutation.isPending,
    creating: createMutation.isPending,
    deleting: deleteMutation.isPending,
    reconnecting: reconnectMutation.isPending,
    pendingGatewayAction,
  }
}

export interface OpenClawStreamEvent {
  type:
    | 'text-delta'
    | 'thinking'
    | 'tool-start'
    | 'tool-end'
    | 'tool-output'
    | 'lifecycle'
    | 'done'
    | 'error'
  data: Record<string, unknown>
}

export interface OpenClawChatHistoryMessage {
  role: 'user' | 'assistant'
  content: string
}

interface ChatHistoryTurnLike {
  userText: string
  parts: Array<{ kind: string; text?: string }>
}

export function buildChatHistoryFromTurns(
  turns: ChatHistoryTurnLike[],
): OpenClawChatHistoryMessage[] {
  const messages: OpenClawChatHistoryMessage[] = []

  for (const turn of turns) {
    const userText = turn.userText.trim()
    if (userText) {
      messages.push({ role: 'user', content: userText })
    }

    const assistantText = turn.parts
      .filter(
        (
          part,
        ): part is {
          kind: 'text'
          text: string
        } => part.kind === 'text' && typeof part.text === 'string',
      )
      .map((part) => part.text.trim())
      .filter(Boolean)
      .join('\n\n')

    if (assistantText) {
      messages.push({ role: 'assistant', content: assistantText })
    }
  }

  return messages
}

export async function chatWithAgent(
  agentId: string,
  message: string,
  sessionKey?: string,
  history: OpenClawChatHistoryMessage[] = [],
  signal?: AbortSignal,
  attachments?: ReadonlyArray<unknown>,
): Promise<Response> {
  const baseUrl = await getAgentServerUrl()
  return fetch(`${baseUrl}/claw/agents/${agentId}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message,
      sessionKey,
      history,
      ...(attachments && attachments.length > 0 ? { attachments } : {}),
    }),
    signal,
  })
}
