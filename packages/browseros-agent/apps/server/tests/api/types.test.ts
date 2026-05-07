import { describe, expect, it } from 'bun:test'
import { ChatRequestSchema } from '../../src/api/types'

describe('ChatRequestSchema', () => {
  it('strips unshipped governance controls from chat requests', () => {
    const parsed = ChatRequestSchema.parse({
      conversationId: crypto.randomUUID(),
      provider: 'openai',
      model: 'gpt-5',
      aclRules: [
        {
          id: 'checkout',
          sitePattern: 'https://example.com/*',
          enabled: true,
        },
      ],
      toolApprovalConfig: { categories: { input: true } },
      toolApprovalResponses: [{ approvalId: 'approval-1', approved: true }],
    })

    expect('aclRules' in parsed).toBe(false)
    expect('toolApprovalConfig' in parsed).toBe(false)
    expect('toolApprovalResponses' in parsed).toBe(false)
  })
})
