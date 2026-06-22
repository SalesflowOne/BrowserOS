import { beforeEach, describe, expect, it, mock } from 'bun:test'
import type {
  ConnectorToolScope,
  KlavisProxyStatus,
} from '../../../src/api/services/klavis'

interface McpServerCreation {
  executionDir: string | undefined
  isRemoteAgentHarness: boolean | undefined
  outputFileAccess: unknown
  proxyStatus: KlavisProxyStatus | null
  selectedServerNames: readonly string[] | undefined
}

const serverCreations: McpServerCreation[] = []
const transportInstances: FakeTransport[] = []
const connectCalls: FakeTransport[] = []

class FakeTransport {
  constructor(readonly options: unknown) {
    transportInstances.push(this)
  }

  handleRequest = mock(async () => Response.json({ ok: true }))
}

const createMcpServerSpy = mock(
  (deps: {
    klavis?: { getProxyStatus(): KlavisProxyStatus }
    connectorScope?: ConnectorToolScope
    executionDir?: string
    isRemoteAgentHarness?: boolean
    outputFileAccess?: unknown
  }) => {
    serverCreations.push({
      executionDir: deps.executionDir,
      isRemoteAgentHarness: deps.isRemoteAgentHarness,
      outputFileAccess: deps.outputFileAccess,
      proxyStatus: deps.klavis?.getProxyStatus() ?? null,
      selectedServerNames: deps.connectorScope?.selectedServerNames,
    })

    return {
      connect: mock(async (transport: FakeTransport) => {
        connectCalls.push(transport)
      }),
    }
  },
)

mock.module('@hono/mcp', () => ({
  StreamableHTTPTransport: FakeTransport,
}))

mock.module('../../../src/api/services/mcp/mcp-server', () => ({
  createMcpServer: createMcpServerSpy,
}))

const {
  MANAGED_MCP_SERVERS_HEADER,
  createMcpRoutes,
  parseManagedMcpServersHeader,
} = await import('../../../src/api/routes/mcp')

beforeEach(() => {
  serverCreations.length = 0
  transportInstances.length = 0
  connectCalls.length = 0
})

async function postMcp(
  app: ReturnType<typeof createMcpRoutes>,
  headers: Record<string, string> = {},
  path = '/',
) {
  return app.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
    }),
  })
}

describe('parseManagedMcpServersHeader', () => {
  it('returns an empty scope for missing or empty headers', () => {
    expect(parseManagedMcpServersHeader(undefined)).toEqual([])
    expect(parseManagedMcpServersHeader('')).toEqual([])
  })

  it('parses comma-separated encoded connector names', () => {
    expect(parseManagedMcpServersHeader('Slack,Google%20Docs,Linear')).toEqual([
      'Slack',
      'Google Docs',
      'Linear',
    ])
  })

  it('degrades malformed encoded values to an empty scope', () => {
    expect(parseManagedMcpServersHeader('Slack,%E0%A4%A')).toEqual([])
  })
})

describe('createMcpRoutes', () => {
  it('passes latest Klavis status and selected connector scope per request', async () => {
    let status: KlavisProxyStatus = { state: 'connecting' }
    const klavis = {
      getProxyStatus: () => status,
    }
    const app = createMcpRoutes({
      version: '0.0.0-test',
      browserSession: {} as never,
      klavis: klavis as never,
      executionDir: '/tmp/browseros-execution',
    })

    const first = await postMcp(app)

    status = { state: 'ready', toolCount: 3 }
    const second = await postMcp(app, {
      [MANAGED_MCP_SERVERS_HEADER]: 'Slack,Google%20Docs',
    })

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(serverCreations).toEqual([
      {
        executionDir: '/tmp/browseros-execution',
        isRemoteAgentHarness: false,
        outputFileAccess: undefined,
        proxyStatus: { state: 'connecting' },
        selectedServerNames: [],
      },
      {
        executionDir: '/tmp/browseros-execution',
        isRemoteAgentHarness: false,
        outputFileAccess: undefined,
        proxyStatus: { state: 'ready', toolCount: 3 },
        selectedServerNames: ['Slack', 'Google Docs'],
      },
    ])
    expect(transportInstances).toHaveLength(2)
    expect(connectCalls).toEqual(transportInstances)
  })

  it('sets the remote agent harness flag only for the remote Hermes source', async () => {
    const app = createMcpRoutes({
      version: '0.0.0-test',
      browserSession: {} as never,
      executionDir: '/tmp/browseros-execution',
    })

    const defaultResponse = await postMcp(app)
    const remoteHermesResponse = await postMcp(
      app,
      {},
      '/?source=remote-hermes',
    )

    expect(defaultResponse.status).toBe(200)
    expect(remoteHermesResponse.status).toBe(200)
    expect(serverCreations).toEqual([
      {
        executionDir: '/tmp/browseros-execution',
        isRemoteAgentHarness: false,
        outputFileAccess: undefined,
        proxyStatus: null,
        selectedServerNames: [],
      },
      {
        executionDir: '/tmp/browseros-execution',
        isRemoteAgentHarness: true,
        outputFileAccess: expect.any(Object),
        proxyStatus: null,
        selectedServerNames: [],
      },
    ])
  })

  it('keeps remote agent harness output-file access stable by scope', async () => {
    const app = createMcpRoutes({
      version: '0.0.0-test',
      browserSession: {} as never,
      executionDir: '/tmp/browseros-execution',
    })

    await postMcp(
      app,
      { 'X-BrowserOS-Scope-Id': 'scope-a' },
      '/?source=remote-hermes',
    )
    await postMcp(
      app,
      { 'X-BrowserOS-Scope-Id': 'scope-a' },
      '/?source=remote-hermes',
    )
    await postMcp(
      app,
      { 'X-BrowserOS-Scope-Id': 'scope-b' },
      '/?source=remote-hermes',
    )

    expect(serverCreations[0].outputFileAccess).toBe(
      serverCreations[1].outputFileAccess,
    )
    expect(serverCreations[2].outputFileAccess).not.toBe(
      serverCreations[0].outputFileAccess,
    )
  })

  it('does not share remote agent harness output-file access without a scope', async () => {
    const app = createMcpRoutes({
      version: '0.0.0-test',
      browserSession: {} as never,
      executionDir: '/tmp/browseros-execution',
    })

    await postMcp(app, {}, '/?source=remote-hermes')
    await postMcp(app, {}, '/?source=remote-hermes')

    expect(serverCreations[0].outputFileAccess).toEqual(expect.any(Object))
    expect(serverCreations[1].outputFileAccess).toEqual(expect.any(Object))
    expect(serverCreations[0].outputFileAccess).not.toBe(
      serverCreations[1].outputFileAccess,
    )
  })

  it('does not silently evict scoped remote agent harness output-file access', async () => {
    const app = createMcpRoutes({
      version: '0.0.0-test',
      browserSession: {} as never,
      executionDir: '/tmp/browseros-execution',
    })

    await postMcp(
      app,
      { 'X-BrowserOS-Scope-Id': 'scope-0' },
      '/?source=remote-hermes',
    )
    const firstScopeAccess = serverCreations[0].outputFileAccess

    for (let i = 1; i <= 80; i++) {
      await postMcp(
        app,
        { 'X-BrowserOS-Scope-Id': `scope-${i}` },
        '/?source=remote-hermes',
      )
    }

    await postMcp(
      app,
      { 'X-BrowserOS-Scope-Id': 'scope-0' },
      '/?source=remote-hermes',
    )

    expect(serverCreations.at(-1)?.outputFileAccess).toBe(firstScopeAccess)
  })
})
