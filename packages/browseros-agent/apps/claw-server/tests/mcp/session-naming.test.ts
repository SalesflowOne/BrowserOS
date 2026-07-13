import { afterEach, describe, expect, it } from 'bun:test'
import {
  type ClientCapabilities,
  type ElicitRequestFormParams,
  type ElicitResult,
  ErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js'
import {
  agentKeyFromClient,
  createIdentityService,
} from '../../src/lib/mcp-session'
import {
  cancelSessionNaming,
  maybeRequestSessionNaming,
  type RequestSessionNamingDeps,
  requestSessionNaming,
  resetSessionNamingForTests,
  type SessionNamingServer,
} from '../../src/mcp/session-naming'

interface ElicitCall {
  params: ElicitRequestFormParams
  options: {
    timeout: number
    relatedRequestId?: string | number
    signal?: AbortSignal
  }
}

function fakeServer(input: {
  capabilities?: ClientCapabilities
  results?: Array<ElicitResult | Error>
}): SessionNamingServer & { calls: ElicitCall[] } {
  const calls: ElicitCall[] = []
  const results = [...(input.results ?? [])]
  let capabilityCalls = 0
  return {
    calls,
    get capabilityCalls() {
      return capabilityCalls
    },
    getClientCapabilities: () => {
      capabilityCalls += 1
      return input.capabilities
    },
    elicitInput: async (params, options) => {
      calls.push({ params, options })
      const result = results.shift()
      if (result instanceof Error) throw result
      if (!result) throw new Error('no fake result queued')
      return result
    },
  }
}

afterEach(() => {
  resetSessionNamingForTests()
})

function setup() {
  const identityService = createIdentityService({ now: () => 1_000 })
  const identity = identityService.registerInitialize({
    sessionId: 'sid-1',
    clientInfo: { name: 'Claude Code', version: '1.0.0' },
  })
  const applyCalls: Array<{
    key: string
    title: string
    session: unknown
  }> = []
  const delays: number[] = []
  const deps: RequestSessionNamingDeps = {
    identityService,
    getBrowserSession: () => ({ fake: true }) as never,
    applyTitle: async (input) => {
      applyCalls.push(input)
    },
    delay: async (ms) => {
      delays.push(ms)
    },
  }
  return { applyCalls, delays, deps, identity, identityService }
}

describe('requestSessionNaming', () => {
  it('does not elicit when the client lacks elicitation capability', async () => {
    const { deps } = setup()
    const server = fakeServer({ capabilities: {} })
    await requestSessionNaming({ server, sessionId: 'sid-1' }, deps)
    expect(server.calls).toEqual([])
  })

  it('stores accepted names and applies the tab-group title', async () => {
    const { applyCalls, deps, identity, identityService } = setup()
    const server = fakeServer({
      capabilities: { elicitation: {} },
      results: [
        {
          action: 'accept',
          content: { name: 'Invoice Processing' },
        },
      ],
    })

    await requestSessionNaming({ server, sessionId: 'sid-1' }, deps)

    expect(identityService.getIdentity('sid-1')?.sessionLabel).toBe(
      'invoice-processing',
    )
    expect(applyCalls).toEqual([
      {
        key: agentKeyFromClient(identity),
        title: 'claude/invoice-processing',
        session: { fake: true },
      },
    ])
    expect(server.calls[0]?.params.message).toContain(
      'Tabs will be grouped as claude/<name>',
    )
    expect(server.calls[0]?.params.requestedSchema.required).toEqual(['name'])
  })

  it('ignores accepted names that normalize to empty', async () => {
    const { applyCalls, deps, identityService } = setup()
    const server = fakeServer({
      capabilities: { elicitation: {} },
      results: [{ action: 'accept', content: { name: '!!!' } }],
    })
    await requestSessionNaming({ server, sessionId: 'sid-1' }, deps)
    expect(identityService.getIdentity('sid-1')?.sessionLabel).toBeNull()
    expect(applyCalls).toEqual([])
  })

  it('ignores decline and cancel results', async () => {
    for (const action of ['decline', 'cancel'] as const) {
      const { applyCalls, deps, identityService } = setup()
      const server = fakeServer({
        capabilities: { elicitation: {} },
        results: [{ action }],
      })
      await requestSessionNaming({ server, sessionId: 'sid-1' }, deps)
      expect(identityService.getIdentity('sid-1')?.sessionLabel).toBeNull()
      expect(applyCalls).toEqual([])
    }
  })

  it('resolves after two elicitation failures without applying a title', async () => {
    const { applyCalls, delays, deps, identityService } = setup()
    const server = fakeServer({
      capabilities: { elicitation: {} },
      results: [new Error('no stream yet'), new Error('still no stream')],
    })
    await requestSessionNaming({ server, sessionId: 'sid-1' }, deps)
    expect(server.calls).toHaveLength(2)
    expect(delays).toEqual([2_000])
    expect(identityService.getIdentity('sid-1')?.sessionLabel).toBeNull()
    expect(applyCalls).toEqual([])
  })

  it('does not retry when the user ignores the elicitation prompt', async () => {
    const { applyCalls, delays, deps, identityService } = setup()
    const server = fakeServer({
      capabilities: { elicitation: {} },
      results: [new McpError(ErrorCode.RequestTimeout, 'timeout')],
    })
    await requestSessionNaming({ server, sessionId: 'sid-1' }, deps)
    expect(server.calls).toHaveLength(1)
    expect(delays).toEqual([])
    expect(identityService.getIdentity('sid-1')?.sessionLabel).toBeNull()
    expect(applyCalls).toEqual([])
  })
})

describe('maybeRequestSessionNaming', () => {
  it('issues elicitation synchronously with the originating request id', async () => {
    const { deps } = setup()
    const server = fakeServer({
      capabilities: { elicitation: {} },
      results: [{ action: 'cancel' }],
    })

    const naming = maybeRequestSessionNaming(
      { server, sessionId: 'sid-1', requestId: 'request-1' },
      deps,
    )

    expect(server.calls).toHaveLength(1)
    expect(server.calls[0]?.options).toMatchObject({
      timeout: 120_000,
      relatedRequestId: 'request-1',
    })
    expect(server.calls[0]?.options.signal).toBeInstanceOf(AbortSignal)
    await naming
  })

  it('elicits only once per session while keeping sessions independent', async () => {
    const { deps, identityService } = setup()
    identityService.registerInitialize({
      sessionId: 'sid-2',
      clientInfo: { name: 'Claude Code', version: '1.0.0' },
    })
    const server = fakeServer({
      capabilities: { elicitation: {} },
      results: [{ action: 'cancel' }, { action: 'cancel' }],
    })

    await Promise.all([
      maybeRequestSessionNaming(
        { server, sessionId: 'sid-1', requestId: 1 },
        deps,
      ),
      maybeRequestSessionNaming(
        { server, sessionId: 'sid-1', requestId: 2 },
        deps,
      ),
      maybeRequestSessionNaming(
        { server, sessionId: 'sid-2', requestId: 3 },
        deps,
      ),
    ])

    expect(server.calls).toHaveLength(2)
    expect(server.calls.map((call) => call.options.relatedRequestId)).toEqual([
      1, 3,
    ])
  })

  it('marks incapable sessions fired without rechecking capabilities', async () => {
    const { deps } = setup()
    const server = fakeServer({ capabilities: {} })

    await maybeRequestSessionNaming(
      { server, sessionId: 'sid-1', requestId: 1 },
      deps,
    )
    await maybeRequestSessionNaming(
      { server, sessionId: 'sid-1', requestId: 2 },
      deps,
    )

    expect(server.capabilityCalls).toBe(1)
    expect(server.calls).toEqual([])
  })

  it('cancels a pending elicitation without retrying or applying a name', async () => {
    const { applyCalls, delays, deps, identityService } = setup()
    const calls: ElicitCall[] = []
    const server: SessionNamingServer = {
      getClientCapabilities: () => ({ elicitation: {} }),
      elicitInput: (params, options) => {
        calls.push({ params, options })
        return new Promise((_, reject) => {
          options.signal?.addEventListener(
            'abort',
            () => reject(new DOMException('aborted', 'AbortError')),
            { once: true },
          )
        })
      },
    }

    const naming = maybeRequestSessionNaming(
      { server, sessionId: 'sid-1', requestId: 1 },
      deps,
    )
    cancelSessionNaming('sid-1')
    await naming

    expect(calls).toHaveLength(1)
    expect(delays).toEqual([])
    expect(identityService.getIdentity('sid-1')?.sessionLabel).toBeNull()
    expect(applyCalls).toEqual([])
  })

  it('stores accepted names and applies the title through injected deps', async () => {
    const { applyCalls, deps, identity, identityService } = setup()
    const server = fakeServer({
      capabilities: { elicitation: {} },
      results: [{ action: 'accept', content: { name: 'Invoice Processing' } }],
    })

    await maybeRequestSessionNaming(
      { server, sessionId: 'sid-1', requestId: 1 },
      deps,
    )

    expect(identityService.getIdentity('sid-1')?.sessionLabel).toBe(
      'invoice-processing',
    )
    expect(applyCalls).toEqual([
      {
        key: agentKeyFromClient(identity),
        title: 'claude/invoice-processing',
        session: { fake: true },
      },
    ])
  })
})
