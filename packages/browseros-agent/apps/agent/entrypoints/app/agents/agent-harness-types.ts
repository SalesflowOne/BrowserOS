import type { AgentEntry } from './useOpenClaw'

export type HarnessAgentAdapter = 'claude' | 'codex'

export type AgentHarnessStreamEvent =
  | {
      type: 'text_delta'
      text: string
      stream: 'output' | 'thought'
      rawType?: string
    }
  | {
      type: 'tool_call'
      text: string
      title: string
      id?: string
      status?: string
      rawType?: string
    }
  | {
      type: 'status'
      text: string
      rawType?: string
    }
  | {
      type: 'done'
      text?: string
      stopReason?: string
    }
  | {
      type: 'error'
      message: string
      code?: string
    }

export interface HarnessAgent {
  id: string
  name: string
  adapter: HarnessAgentAdapter
  modelId?: string
  reasoningEffort?: string
  permissionMode: 'approve-all'
  sessionKey: string
  createdAt: number
  updatedAt: number
}

export interface HarnessAdapterDescriptor {
  id: HarnessAgentAdapter
  name: string
  defaultModelId: string
  defaultReasoningEffort: string
  modelControl: 'runtime-supported' | 'best-effort'
  models: Array<{ id: string; label: string; recommended?: boolean }>
  reasoningEfforts: Array<{ id: string; label: string; recommended?: boolean }>
}

export interface CreateHarnessAgentInput {
  name: string
  adapter: HarnessAgentAdapter
  modelId?: string
  reasoningEffort?: string
}

export interface HarnessTranscriptEntry {
  id: string
  agentId: string
  sessionId: 'main'
  role: 'user' | 'assistant'
  text: string
  createdAt: number
}

export interface HarnessAgentHistoryPage {
  agentId: string
  sessionId: 'main'
  items: HarnessTranscriptEntry[]
}

export function mapHarnessAgentToEntry(agent: HarnessAgent): AgentEntry {
  return {
    agentId: agent.id,
    name: agent.name,
    workspace: `${agent.adapter}:main`,
    model: agent.modelId,
    source: 'agent-harness',
  }
}
