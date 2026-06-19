/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { LLM_PROVIDERS } from '@browseros/shared/schemas/llm'

const openAICompatibleCalls: Array<Record<string, unknown>> = []

mock.module('@ai-sdk/openai-compatible', () => ({
  createOpenAICompatible: mock((options: Record<string, unknown>) => {
    openAICompatibleCalls.push(options)
    return (modelId: string) => ({
      modelId,
      providerOptions: options,
    })
  }),
}))

const { createLLMProvider } = await import(
  '../../../../src/lib/clients/llm/provider'
)
const { createLanguageModel } = await import(
  '../../../../src/agent/provider-factory'
)

const qwenConfig = (overrides: Record<string, unknown> = {}) => ({
  provider: LLM_PROVIDERS.QWEN_CODE,
  model: 'qwen3-coder-plus',
  baseUrl: 'https://coding.dashscope.aliyuncs.com/v1',
  apiKey: 'sk-test',
  ...overrides,
})

beforeEach(() => {
  openAICompatibleCalls.length = 0
})

describe('createLLMProvider - Qwen Code', () => {
  it('creates an OpenAI-compatible model with the configured endpoint', () => {
    const model = createLLMProvider(qwenConfig() as never) as {
      modelId: string
      providerOptions: Record<string, unknown>
    }

    expect(model.modelId).toBe('qwen3-coder-plus')
    expect(openAICompatibleCalls).toEqual([
      {
        name: 'qwen-code',
        baseURL: 'https://coding.dashscope.aliyuncs.com/v1',
        apiKey: 'sk-test',
      },
    ])
  })

  it('requires endpoint credentials', () => {
    expect(() =>
      createLLMProvider(qwenConfig({ baseUrl: undefined }) as never),
    ).toThrow('Qwen Code provider requires baseUrl')
    expect(() =>
      createLLMProvider(qwenConfig({ apiKey: undefined }) as never),
    ).toThrow('Qwen Code provider requires apiKey')
  })
})

describe('createLanguageModel - Qwen Code', () => {
  it('creates an OpenAI-compatible model with the configured endpoint', async () => {
    const result = (await createLanguageModel({
      conversationId: 'conv-qwen',
      ...qwenConfig(),
    } as never)) as {
      model: { modelId: string; providerOptions: Record<string, unknown> }
      close?: () => Promise<void>
    }

    expect(result.model.modelId).toBe('qwen3-coder-plus')
    expect(result.close).toBeUndefined()
    expect(openAICompatibleCalls).toEqual([
      {
        name: 'qwen-code',
        baseURL: 'https://coding.dashscope.aliyuncs.com/v1',
        apiKey: 'sk-test',
      },
    ])
  })

  it('requires endpoint credentials', async () => {
    await expect(
      createLanguageModel({
        conversationId: 'conv-qwen',
        ...qwenConfig({ baseUrl: undefined }),
      } as never),
    ).rejects.toThrow('Qwen Code provider requires baseUrl')
    await expect(
      createLanguageModel({
        conversationId: 'conv-qwen',
        ...qwenConfig({ apiKey: undefined }),
      } as never),
    ).rejects.toThrow('Qwen Code provider requires apiKey')
  })
})
