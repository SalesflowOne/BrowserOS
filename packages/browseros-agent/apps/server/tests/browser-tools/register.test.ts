import { describe, expect, it } from 'bun:test'
import { TOOL_LIMITS } from '@browseros/shared/constants/limits'
import type { BrowserSession } from '../../src/browser/core/session'
import { registerBrowserTools } from '../../src/browser-tools/register'
import { BROWSER_TOOLS } from '../../src/browser-tools/registry'

type RegisteredHandler = (args: Record<string, unknown>) => Promise<{
  content: unknown
  isError?: boolean
  structuredContent?: unknown
}>

function createFakeServer() {
  const handlers = new Map<string, RegisteredHandler>()
  const configs = new Map<
    string,
    { description: string; inputSchema?: unknown }
  >()

  return {
    handlers,
    configs,
    server: {
      registerTool(
        name: string,
        config: { description: string; inputSchema?: unknown },
        handler: RegisteredHandler,
      ) {
        configs.set(name, config)
        handlers.set(name, handler)
      },
    },
  }
}

describe('registerBrowserTools', () => {
  it('registers the compact browser tool surface', () => {
    const fake = createFakeServer()
    const session = { pages: {} } as unknown as BrowserSession

    registerBrowserTools(fake.server as never, session)

    expect([...fake.handlers.keys()]).toEqual(BROWSER_TOOLS.map((t) => t.name))
    expect(fake.handlers.size).toBe(10)
    expect(fake.configs.get('tabs')?.inputSchema).toBeDefined()
  })

  it('applies scoped defaults when opening a new tab', async () => {
    const fake = createFakeServer()
    const calls: Array<{
      url: string
      opts?: {
        background?: boolean
        hidden?: boolean
        windowId?: number
        tabGroupId?: string
      }
    }> = []
    const session = {
      pages: {
        newPage: async (
          url: string,
          opts?: {
            background?: boolean
            hidden?: boolean
            windowId?: number
            tabGroupId?: string
          },
        ) => {
          calls.push({ url, opts })
          return 42
        },
      },
    } as unknown as BrowserSession

    registerBrowserTools(fake.server as never, session, {
      defaultWindowId: 7,
      defaultTabGroupId: 'group-a',
    })

    const result = await fake.handlers.get('tabs')?.({
      action: 'new',
      url: 'https://example.com',
    })

    expect(result?.isError).toBeFalsy()
    expect(result?.structuredContent).toEqual({ page: 42 })
    expect(calls).toEqual([
      {
        url: 'https://example.com',
        opts: {
          background: true,
          hidden: false,
          windowId: 7,
          tabGroupId: 'group-a',
        },
      },
    ])
  })

  it('runs page-context JavaScript through the page session', async () => {
    const fake = createFakeServer()
    const evaluateCalls: Array<Record<string, unknown>> = []
    const session = {
      pages: {
        getSession: async () => ({
          session: {
            Runtime: {
              evaluate: async (params: Record<string, unknown>) => {
                evaluateCalls.push(params)
                return { result: { value: 'page-value' } }
              },
            },
          },
        }),
      },
    } as unknown as BrowserSession

    registerBrowserTools(fake.server as never, session)

    const result = await fake.handlers.get('run')?.({
      page: 3,
      code: 'return document.title',
      timeout: 1234,
    })

    expect(result?.isError).toBeFalsy()
    expect(result?.structuredContent).toEqual({ page: 3, value: 'page-value' })
    expect(evaluateCalls).toHaveLength(1)
    expect(evaluateCalls[0]).toMatchObject({
      awaitPromise: true,
      returnByValue: true,
      timeout: 1234,
      userGesture: true,
    })
    expect(String(evaluateCalls[0]?.expression)).toContain(
      'return document.title',
    )
  })

  it('caps large read results and writes the full content to a file', async () => {
    const fake = createFakeServer()
    const largeText = 'x'.repeat(TOOL_LIMITS.INLINE_PAGE_CONTENT_MAX_CHARS + 1)
    const session = {
      pages: {
        getSession: async () => ({
          session: {
            Runtime: {
              evaluate: async () => ({ result: { value: largeText } }),
            },
          },
        }),
        getInfo: () => ({ url: 'https://example.com' }),
      },
    } as unknown as BrowserSession

    registerBrowserTools(fake.server as never, session)

    const result = await fake.handlers.get('read')?.({
      page: 1,
      format: 'text',
    })

    expect(result?.isError).toBeFalsy()
    expect(result?.structuredContent).toMatchObject({
      page: 1,
      format: 'text',
      contentLength: largeText.length,
      writtenToFile: true,
    })
    expect(result?.content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'text',
          text: expect.stringContaining('Content truncated'),
        }),
      ]),
    )
  })
})
