import { describe, expect, test } from 'bun:test'

import {
  formatModelsData,
  generateModelsData,
  type ModelsDevModel,
  type ModelsDevProvider,
} from './generate-models'

function model(overrides: Partial<ModelsDevModel>): ModelsDevModel {
  return {
    id: 'model-a',
    name: 'Model A',
    attachment: false,
    reasoning: false,
    tool_call: true,
    modalities: { input: ['text'], output: ['text'] },
    limit: { context: 128000, output: 8192 },
    release_date: '2026-01-01',
    last_updated: '2026-01-01',
    ...overrides,
  }
}

function provider(models: Record<string, ModelsDevModel>): ModelsDevProvider {
  return {
    id: 'source-provider',
    name: 'Source Provider',
    npm: '@ai-sdk/source-provider',
    doc: 'https://example.com/docs',
    env: ['SOURCE_API_KEY'],
    models,
  }
}

describe('generateModelsData', () => {
  test('maps providers and omits deprecated models', () => {
    const output = generateModelsData(
      {
        'source-provider': provider({
          current: model({
            id: 'current-model',
            name: 'Current Model',
            attachment: true,
            reasoning: true,
            cost: { input: 1, output: 2 },
          }),
          deprecated: model({
            id: 'deprecated-model',
            status: 'deprecated',
          }),
        }),
      },
      { 'source-provider': 'browseros-provider' },
    )

    expect(Object.keys(output)).toEqual(['browseros-provider'])
    expect(output['browseros-provider']).toEqual({
      name: 'Source Provider',
      doc: 'https://example.com/docs',
      models: [
        {
          id: 'current-model',
          name: 'Current Model',
          contextWindow: 128000,
          maxOutput: 8192,
          supportsImages: true,
          supportsReasoning: true,
          supportsToolCall: true,
          inputCost: 1,
          outputCost: 2,
        },
      ],
    })
  })

  test('sorts models by last update then id', () => {
    const output = generateModelsData(
      {
        'source-provider': provider({
          b: model({ id: 'b-model', last_updated: '2026-01-01' }),
          a: model({ id: 'a-model', last_updated: '2026-01-01' }),
          c: model({ id: 'c-model', last_updated: '2026-02-01' }),
        }),
      },
      { 'source-provider': 'browseros-provider' },
    )

    expect(output['browseros-provider']?.models.map((m) => m.id)).toEqual([
      'c-model',
      'a-model',
      'b-model',
    ])
  })

  test('rejects duplicate transformed model ids', () => {
    expect(() =>
      generateModelsData(
        {
          'source-provider': provider({
            first: model({ id: 'duplicate-model' }),
            second: model({ id: 'duplicate-model' }),
          }),
        },
        { 'source-provider': 'browseros-provider' },
      ),
    ).toThrow('Duplicate model id for browseros-provider: duplicate-model')
  })

  test('rejects missing required providers', () => {
    expect(() =>
      generateModelsData({}, { 'source-provider': 'browseros-provider' }),
    ).toThrow('Provider not found in models.dev: source-provider')
  })

  test('formats generated JSON with a trailing newline', () => {
    const output = {
      'browseros-provider': {
        name: 'Source Provider',
        doc: 'https://example.com/docs',
        models: [],
      },
    }

    const json = formatModelsData(output)

    expect(json.endsWith('\n')).toBe(true)
    expect(JSON.parse(json)).toEqual(output)
  })
})
