import { describe, expect, it } from 'bun:test'
import { providerTemplates } from './providerTemplates'

describe('providerTemplates', () => {
  it('uses GPT-5.5 for new ChatGPT Plus/Pro providers', () => {
    const template = providerTemplates.find(
      (provider) => provider.id === 'chatgpt-pro',
    )

    expect(template).toMatchObject({
      defaultModelId: 'gpt-5.5',
      contextWindow: 1050000,
    })
  })

  it('uses the Qwen Code API-key endpoint for new Qwen providers', () => {
    const template = providerTemplates.find(
      (provider) => provider.id === 'qwen-code',
    )

    expect(template).toMatchObject({
      defaultBaseUrl: 'https://coding.dashscope.aliyuncs.com/v1',
      defaultModelId: 'qwen3-coder-plus',
      contextWindow: 1000000,
      apiKeyUrl: 'https://modelstudio.console.alibabacloud.com/',
    })
  })
})
