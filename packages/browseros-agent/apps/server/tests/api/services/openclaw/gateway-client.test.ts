import { afterEach, describe, expect, it } from 'bun:test'
import { WebSocketServer } from 'ws'
import { GatewayClient } from '../../../../src/api/services/openclaw/gateway-client'

async function startMockGateway(
  handler: (ws: WebSocket, frame: unknown) => void,
) {
  const wss = new WebSocketServer({ port: 0 })
  await new Promise<void>((r) => wss.on('listening', () => r()))
  const addr = wss.address()
  const port = typeof addr === 'object' && addr ? addr.port : 0
  wss.on('connection', (ws) => {
    ws.on('message', (data) =>
      handler(ws as unknown as WebSocket, JSON.parse(data.toString())),
    )
  })
  return { port, close: () => wss.close() }
}

describe('GatewayClient (full-trust mode)', () => {
  let mock: Awaited<ReturnType<typeof startMockGateway>>

  afterEach(() => mock?.close())

  it('sends anonymous connect with client.id=control-ui and no device block', async () => {
    let captured: Record<string, unknown> | null = null
    mock = await startMockGateway((ws, frame) => {
      if ((frame as { method?: string }).method === 'connect') {
        captured = frame as Record<string, unknown>
        ws.send(
          JSON.stringify({
            type: 'res',
            id: (frame as { id: string }).id,
            ok: true,
          }),
        )
      }
    })

    const client = new GatewayClient(mock.port, '/tmp/openclaw-test')
    await client.connect()

    expect(captured).toBeTruthy()
    const params = (captured as { params: Record<string, unknown> }).params
    expect((params.client as { id: string }).id).toBe('control-ui')
    expect(params.device).toBeUndefined()
    expect(params.auth).toBeUndefined()
    expect((params.scopes as string[]).length).toBeGreaterThan(0)

    client.disconnect()
  })

  it('round-trips an RPC after connect', async () => {
    mock = await startMockGateway((ws, frame) => {
      const f = frame as { id: string; method: string }
      if (f.method === 'connect') {
        ws.send(JSON.stringify({ type: 'res', id: f.id, ok: true }))
        return
      }
      if (f.method === 'agents.list') {
        ws.send(
          JSON.stringify({
            type: 'res',
            id: f.id,
            ok: true,
            payload: { agents: [] },
          }),
        )
      }
    })

    const client = new GatewayClient(mock.port, '/tmp/openclaw-test')
    await client.connect()
    const agents = await client.listAgents()
    expect(agents).toEqual([])
    client.disconnect()
  })
})
