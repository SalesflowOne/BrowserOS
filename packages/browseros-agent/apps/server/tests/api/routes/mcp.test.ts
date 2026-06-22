import { beforeEach, describe, expect, it, mock } from 'bun:test'
import type {
  ConnectorToolScope,
  KlavisProxyStatus,
} from '../../../src/api/services/klavis'

interface McpServerCreation {
  executionDir: string | undefined
  isRemoteAgentHarness: boolean | undefined
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
  }) => {
    serverCreations.push({
      executionDir: deps.executionDir,
      isRemoteAgentHarness: deps.isRemoteAgentHarness,
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
        proxyStatus: { state: 'connecting' },
        selectedServerNames: [],
      },
      {
        executionDir: '/tmp/browseros-execution',
        isRemoteAgentHarness: false,
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
        proxyStatus: null,
        selectedServerNames: [],
      },
      {
        executionDir: '/tmp/browseros-execution',
        isRemoteAgentHarness: true,
        proxyStatus: null,
        selectedServerNames: [],
      },
    ])
  })
})
