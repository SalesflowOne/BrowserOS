import { describe, expect, it } from 'bun:test'
import type { LlmProviderConfig } from '@/lib/llm-providers/types'
import { buildChatRequestBody } from './buildChatRequestBody'

const provider: LlmProviderConfig = {
  id: 'browseros',
  type: 'browseros',
  name: 'BrowserOS',
  modelId: 'browseros-auto',
  supportsImages: true,
  contextWindow: 200000,
  temperature: 0,
  createdAt: 0,
  updatedAt: 0,
}

describe('buildChatRequestBody', () => {
  it('omits unshipped governance controls from chat requests', () => {
    const body = buildChatRequestBody({
      conversationId: '6ff46e3b-e45a-40a4-9157-ca520e800f43',
      provider,
      mode: 'agent',
      browserContext: {
        windowId: 2,
        activeTab: {
          id: 10,
          url: 'https://amazon.com',
          title: 'Amazon',
        },
        enabledMcpServers: ['slack'],
      },
      userSystemPrompt: 'Stay in the current tab.',
      aclRules: [
        {
          id: 'checkout',
          sitePattern: 'https://example.com/*',
          enabled: true,
        },
      ],
      toolApprovalConfig: { categories: { input: true } },
      toolApprovalResponses: [
        {
          approvalId: 'approval-1',
          approved: true,
        },
      ],
    } as Parameters<typeof buildChatRequestBody>[0])

    expect(body.browserContext).toEqual({
      windowId: 2,
      activeTab: {
        id: 10,
        url: 'https://amazon.com',
        title: 'Amazon',
      },
      enabledMcpServers: ['slack'],
    })
    const bodyRecord = body as Record<string, unknown>
    expect(bodyRecord.aclRules).toBeUndefined()
    expect(bodyRecord.toolApprovalConfig).toBeUndefined()
    expect(bodyRecord.toolApprovalResponses).toBeUndefined()
  })
})
