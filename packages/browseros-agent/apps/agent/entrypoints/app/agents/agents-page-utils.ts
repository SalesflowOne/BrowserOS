import type { LlmProviderConfig } from '@/lib/llm-providers/types'
import type { HarnessAgent, HarnessAgentAdapter } from './agent-harness-types'
import type { AgentListItem, ProviderOption } from './agents-page-types'
import { getOpenClawSupportedProviders } from './openclaw-supported-providers'
import { type AgentEntry, getModelDisplayName } from './useOpenClaw'

export function formatHarnessAdapter(adapter: HarnessAgentAdapter): string {
  return adapter === 'claude' ? 'Claude Code' : 'Codex'
}

export function toProviderOptions(
  providers: LlmProviderConfig[],
  cliProviders: ProviderOption[],
): ProviderOption[] {
  return [...getOpenClawSupportedProviders(providers), ...cliProviders]
}

export function toOpenClawListItem(
  agent: AgentEntry,
  canManageAgents: boolean,
): AgentListItem {
  return {
    key: `openclaw:${agent.agentId}`,
    agentId: agent.agentId,
    name: agent.name,
    source: 'openclaw',
    runtimeLabel: 'OpenClaw',
    modelLabel: getModelDisplayName(agent.model) ?? 'default',
    detail: agent.workspace,
    canChat: canManageAgents,
    canDelete: canManageAgents && agent.agentId !== 'main',
  }
}

export function toHarnessListItem(agent: HarnessAgent): AgentListItem {
  return {
    key: `agent-harness:${agent.id}`,
    agentId: agent.id,
    name: agent.name,
    source: 'agent-harness',
    runtimeLabel: formatHarnessAdapter(agent.adapter),
    modelLabel: agent.modelId ?? 'default',
    detail: `${agent.adapter}:main`,
    canChat: true,
    canDelete: true,
  }
}

export function getVisibleOpenClawAgents(
  enabled: boolean,
  agents: AgentEntry[],
): AgentEntry[] {
  return enabled ? agents : []
}

export function getAgentsLoading(input: {
  adaptersLoading: boolean
  harnessAgentsLoading: boolean
  openClawAgentsLoading: boolean
}): boolean {
  return (
    input.adaptersLoading ||
    input.harnessAgentsLoading ||
    input.openClawAgentsLoading
  )
}

export function getInlineError(input: {
  lifecyclePending: boolean
  pageError: string | null
  openClawAgentsError: Error | null
  adaptersError: Error | null
  harnessAgentsError: Error | null
}): string | null {
  if (input.lifecyclePending) return null
  return (
    input.pageError ??
    input.openClawAgentsError?.message ??
    input.adaptersError?.message ??
    input.harnessAgentsError?.message ??
    null
  )
}
