/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Pins the metaproperty guard in createDomainProxy. Pre-fix, the
 * proxy's `get` trap treated EVERY property access as a CDP method
 * call. That meant JSON.stringify, `await`, util.inspect, pino /
 * bun structured loggers, and error printers walking a session
 * accidentally fabricated CDP requests like `Runtime.toJSON` /
 * `HeapProfiler.then`, which BrowserOS silently drops and our
 * client rejects after 30 s with `CDP request timeout: <Domain>.
 * <meta>`. Post-fix, metaproperty probes short-circuit to safe
 * defaults and only real CDP method names route through send.
 */

import { describe, expect, it, mock } from 'bun:test'
import { createProtocolApi } from '../src/generated/create-api'

function makeApiWithSpies() {
  const send = mock(async (_method: string, _params?: unknown) => undefined)
  const on = mock((_event: string, _handler: (p: unknown) => void) => () => {})
  const api = createProtocolApi(send as never, on as never)
  return { api, send, on }
}

describe('createDomainProxy metaproperty guard', () => {
  it('real CDP method calls still route through send', async () => {
    const { api, send } = makeApiWithSpies()
    await api.Runtime.evaluate({ expression: '1+1' })
    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith('Runtime.evaluate', {
      expression: '1+1',
    })
  })

  it('event listener registration still routes through on', () => {
    const { api, on } = makeApiWithSpies()
    const handler = () => {}
    api.Runtime.on('executionContextCreated', handler)
    expect(on).toHaveBeenCalledWith('Runtime.executionContextCreated', handler)
  })

  it('JSON.stringify does not fire send', () => {
    const { api, send } = makeApiWithSpies()
    const out = JSON.stringify({
      r: api.Runtime,
      h: api.HeapProfiler,
      p: api.Profiler,
      s: api.Schema,
    })
    expect(send).not.toHaveBeenCalled()
    // toJSON returns a string tag we can spot in the output.
    expect(out).toContain('[CDP:Runtime]')
    expect(out).toContain('[CDP:HeapProfiler]')
    expect(out).toContain('[CDP:Profiler]')
    expect(out).toContain('[CDP:Schema]')
  })

  it('await on a domain proxy does not fire send (then returns undefined)', async () => {
    const { api, send } = makeApiWithSpies()
    // `.then` must not look like a thenable; otherwise `await`
    // calls it and CDP sees `Runtime.then`. Post-guard, `.then`
    // returns undefined so `await` resolves to the proxy itself.
    const resolved = await api.Runtime
    expect(send).not.toHaveBeenCalled()
    expect(resolved).toBe(api.Runtime)
  })

  it('is-promise / is-thenable duck-typing probes do not fire send', () => {
    // `await` only probes `.then`, but many is-promise-style
    // helpers (is-promise, is-thenable, error serialisers,
    // structured loggers, test assertion utilities) probe the
    // full duck-typing surface: `.then`, `.catch`, `.finally`.
    // Each must return undefined so those helpers see a
    // non-thenable and the domain proxy does not fabricate
    // `<Domain>.catch` / `<Domain>.finally` CDP requests.
    const { api, send } = makeApiWithSpies()
    const runtime = api.Runtime as Record<string, unknown>
    expect(runtime.then).toBeUndefined()
    expect(runtime.catch).toBeUndefined()
    expect(runtime.finally).toBeUndefined()
    expect(send).not.toHaveBeenCalled()
  })

  it('Symbol probes return undefined and do not fire send', () => {
    const { api, send } = makeApiWithSpies()
    const runtime = api.Runtime as Record<symbol, unknown>
    expect(runtime[Symbol.iterator]).toBeUndefined()
    expect(runtime[Symbol.toPrimitive]).toBeUndefined()
    expect(runtime[Symbol.asyncIterator]).toBeUndefined()
    expect(runtime[Symbol.for('nodejs.util.inspect.custom')]).toBeUndefined()
    expect(send).not.toHaveBeenCalled()
  })

  it('runtime + DOM metaproperty probes short-circuit and do not fire send', () => {
    const { api, send } = makeApiWithSpies()
    const runtime = api.Runtime as Record<string, unknown>
    expect(runtime.nodeType).toBeUndefined()
    expect(runtime.nodeName).toBeUndefined()
    expect(runtime.tagName).toBeUndefined()
    expect(runtime.constructor).toBeUndefined()
    expect(runtime.toString).toBeUndefined()
    expect(runtime.valueOf).toBeUndefined()
    expect(runtime.inspect).toBeUndefined()
    expect(send).not.toHaveBeenCalled()
  })

  it('camelCase CDP methods that only look like real methods still route', async () => {
    // A future / rare CDP method that only differs from a
    // metaproperty by casing must still route. We do not guard on
    // full lower-case English words; only the specific well-known
    // metaproperty names.
    const { api, send } = makeApiWithSpies()
    const runtime = api.Runtime as unknown as {
      getProperties: (p: Record<string, unknown>) => Promise<unknown>
      evaluate: (p: Record<string, unknown>) => Promise<unknown>
    }
    await runtime.getProperties({ objectId: 'x' })
    await runtime.evaluate({ expression: '1' })
    expect(send).toHaveBeenNthCalledWith(1, 'Runtime.getProperties', {
      objectId: 'x',
    })
    expect(send).toHaveBeenNthCalledWith(2, 'Runtime.evaluate', {
      expression: '1',
    })
  })
})
