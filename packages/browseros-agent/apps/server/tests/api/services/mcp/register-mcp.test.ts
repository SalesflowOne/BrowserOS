import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { registerTools } from '../../../../src/api/services/mcp/register-mcp'
import type { BrowserSession } from '../../../../src/browser/core/session'
import { logger } from '../../../../src/lib/logger'
import { BROWSER_TOOLS } from '../../../../src/tools/browser/registry'
import { resetToolRegistrationLogSamplingForTests } from '../../../../src/tools/registration-log-sampling'

type RegisteredHandler = (
  args: Record<string, unknown>,
  extra?: { signal?: AbortSignal },
) => Promise<{
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

describe('registerTools', () => {
  const originalInfo = logger.info
  const filesystemToolNames = [
    'filesystem_read',
    'filesystem_write',
    'filesystem_edit',
    'filesystem_bash',
    'filesystem_grep',
    'filesystem_find',
    'filesystem_ls',
  ]
  let infoMessages: unknown[] = []

  beforeEach(() => {
    resetToolRegistrationLogSamplingForTests()
    infoMessages = []
    logger.info = ((message: string) => {
      infoMessages.push(message)
    }) as typeof logger.info
  })

  afterEach(() => {
    logger.info = originalInfo
    resetToolRegistrationLogSamplingForTests()
  })

  it('registers the browser tools', () => {
    const fake = createFakeServer()

    registerTools(fake.server as never, {
      browserSession: { pages: {} } as unknown as BrowserSession,
      executionDir: '/tmp/browseros-execution',
      isRemoteAgentHarness: false,
    })

    expect([...fake.handlers.keys()]).toEqual(BROWSER_TOOLS.map((t) => t.name))
    expect(fake.handlers.size).toBe(BROWSER_TOOLS.length)
  })

  it('registers filesystem tools for remote agent harness requests', () => {
    const fake = createFakeServer()

    registerTools(fake.server as never, {
      browserSession: { pages: {} } as unknown as BrowserSession,
      executionDir: '/tmp/browseros-execution',
      isRemoteAgentHarness: true,
    })

    expect([...fake.handlers.keys()]).toEqual([
      ...BROWSER_TOOLS.map((t) => t.name),
      ...filesystemToolNames,
    ])
  })

  it('samples repeated registration info logs without skipping tool registration', () => {
    for (let i = 0; i < 20; i++) {
      const fake = createFakeServer()
      registerTools(fake.server as never, {
        browserSession: { pages: {} } as unknown as BrowserSession,
        executionDir: '/tmp/browseros-execution',
        isRemoteAgentHarness: false,
      })

      if (i === 1) {
        expect([...fake.handlers.keys()]).toEqual(
          BROWSER_TOOLS.map((t) => t.name),
        )
      }
      if (i === 2) {
        expect(fake.handlers.has('tabs')).toBe(true)
        expect(fake.handlers.has('new_page')).toBe(false)
      }
    }

    expect(infoMessages).toHaveLength(2)
    expect(infoMessages).toEqual([
      expect.stringContaining(
        `Registered ${BROWSER_TOOLS.length} browser tools`,
      ),
      expect.stringContaining(
        `Registered ${BROWSER_TOOLS.length} browser tools`,
      ),
    ])
  })

  it('applies scoped defaults to tab creation', async () => {
    const fake = createFakeServer()
    const newPageCalls: Array<{
      url: string
      opts?: {
        background?: boolean
        hidden?: boolean
        tabGroupId?: string
        windowId?: number
      }
    }> = []

    registerTools(fake.server as never, {
      browserSession: {
        pages: {
          newPage: async (
            url: string,
            opts?: {
              background?: boolean
              hidden?: boolean
              tabGroupId?: string
              windowId?: number
            },
          ) => {
            newPageCalls.push({ url, opts })
            return 42
          },
        },
      } as unknown as BrowserSession,
      defaultWindowId: 7,
      defaultTabGroupId: 'group-a',
      executionDir: '/tmp/browseros-execution',
      isRemoteAgentHarness: false,
    })

    const result = await fake.handlers.get('tabs')?.({
      action: 'new',
      url: 'https://example.com',
    })

    expect(result?.isError).toBeFalsy()
    expect(result?.structuredContent).toEqual({ page: 42 })
    expect(newPageCalls).toEqual([
      {
        url: 'https://example.com',
        opts: {
          background: true,
          hidden: false,
          tabGroupId: 'group-a',
          windowId: 7,
        },
      },
    ])
  })
})
