/**
 * @license
 * Copyright 2025 BrowserOS
 */

import { describe, expect, it, mock } from 'bun:test'
import {
  buildKlavisToolSet,
  type KlavisProxyHandle,
} from '../../../../src/api/services/klavis/strata-proxy'

describe('buildKlavisToolSet', () => {
  it('maps MCP content results into model content parts', async () => {
    const handle: KlavisProxyHandle = {
      tools: [
        {
          name: 'gmail_search',
          description: 'Search Gmail',
          inputSchema: { type: 'object' },
        } as never,
      ],
      inputSchemas: new Map([['gmail_search', {} as never]]),
      callTool: mock(async () => ({
        content: [
          { type: 'text', text: 'Found 2 threads' },
          {
            type: 'image',
            data: 'ZmFrZS1pbWFnZQ==',
            mimeType: 'image/png',
          },
        ],
      })),
      close: async () => {},
    }

    const toolSet = buildKlavisToolSet(handle)
    const searchTool = toolSet.gmail_search

    expect(searchTool).toBeDefined()

    const output = await searchTool.execute?.({})
    const modelOutput = await searchTool.toModelOutput?.({
      toolCallId: 'call-1',
      input: {},
      output,
    })

    expect(modelOutput).toEqual({
      type: 'content',
      value: [
        { type: 'text', text: 'Found 2 threads' },
        {
          type: 'image-data',
          data: 'ZmFrZS1pbWFnZQ==',
          mediaType: 'image/png',
        },
      ],
    })
  })

  it('falls back to JSON output for non-content MCP responses', async () => {
    const handle: KlavisProxyHandle = {
      tools: [
        {
          name: 'notion_lookup',
          description: 'Lookup Notion',
          inputSchema: { type: 'object' },
        } as never,
      ],
      inputSchemas: new Map([['notion_lookup', {} as never]]),
      callTool: mock(async () => ({
        toolResult: {
          pageId: 'abc123',
          title: 'Quarterly Plan',
        },
      })),
      close: async () => {},
    }

    const toolSet = buildKlavisToolSet(handle)
    const lookupTool = toolSet.notion_lookup

    expect(lookupTool).toBeDefined()

    const output = await lookupTool.execute?.({})
    const modelOutput = await lookupTool.toModelOutput?.({
      toolCallId: 'call-2',
      input: {},
      output,
    })

    expect(modelOutput).toEqual({
      type: 'json',
      value: {
        toolResult: {
          pageId: 'abc123',
          title: 'Quarterly Plan',
        },
      },
    })
  })
})
