import { afterEach, describe, expect, it } from 'bun:test'
import {
  resolveBrowserOSMcpBaseUrl,
  resolveBrowserOSServerBaseUrl,
} from './browseros-ports'
import { resolveApiBaseUrlFromSources } from './client.helpers'

const fallback = 'http://127.0.0.1:9200'
const originalChrome = globalThis.chrome

function installBrowserOSPrefs(values: Record<string, unknown>) {
  Object.defineProperty(globalThis, 'chrome', {
    configurable: true,
    value: {
      runtime: {},
      browserOS: {
        getPref(
          name: string,
          callback: (pref: chrome.browserOS.PrefObject) => void,
        ) {
          callback({
            key: name,
            type: typeof values[name],
            value: values[name],
          })
        },
      },
    },
  })
}

afterEach(() => {
  Object.defineProperty(globalThis, 'chrome', {
    configurable: true,
    value: originalChrome,
  })
})

describe('resolveApiBaseUrlFromSources', () => {
  it('prefers the query override', () => {
    expect(
      resolveApiBaseUrlFromSources({
        query: 'http://127.0.0.1:9200',
        stored: 'http://127.0.0.1:9300',
        launcher: 'http://127.0.0.1:9400',
        fallback,
      }),
    ).toBe('http://127.0.0.1:9200')
  })

  it('uses session storage before the launcher env', () => {
    expect(
      resolveApiBaseUrlFromSources({
        query: null,
        stored: 'http://127.0.0.1:9300',
        launcher: 'http://127.0.0.1:9400',
        fallback,
      }),
    ).toBe('http://127.0.0.1:9300')
  })

  it('uses the launcher env before the default fallback', () => {
    expect(
      resolveApiBaseUrlFromSources({
        query: null,
        stored: null,
        launcher: 'http://127.0.0.1:9400',
        fallback,
      }),
    ).toBe('http://127.0.0.1:9400')
  })

  it('ignores non-loopback overrides', () => {
    expect(
      resolveApiBaseUrlFromSources({
        query: 'https://example.com',
        stored: 'http://localhost:9300',
        launcher: 'http://0.0.0.0:9400',
        fallback,
      }),
    ).toBe(fallback)
  })

  it('rejects loopback-looking URLs that parse to another host', () => {
    expect(
      resolveApiBaseUrlFromSources({
        query: 'http://127.0.0.1:@example.com',
        stored: null,
        launcher: null,
        fallback,
      }),
    ).toBe(fallback)
  })

  it('rejects malformed ports and pathful URLs', () => {
    expect(
      resolveApiBaseUrlFromSources({
        query: 'http://127.0.0.1:99999',
        stored: 'http://127.0.0.1:9300/cockpit',
        launcher: 'http://127.0.0.1:9400?x=1',
        fallback,
      }),
    ).toBe(fallback)
  })
})

describe('BrowserOS managed port resolution', () => {
  it('prefers the BrowserOS server port pref for API traffic', async () => {
    installBrowserOSPrefs({ 'browseros.server.server_port': 9511 })

    await expect(
      resolveBrowserOSServerBaseUrl({
        query: 'http://127.0.0.1:9201',
        stored: 'http://127.0.0.1:9202',
        launcher: 'http://127.0.0.1:9203',
        fallback,
      }),
    ).resolves.toBe('http://127.0.0.1:9511')
  })

  it('prefers the BrowserOS proxy port pref for MCP traffic', async () => {
    installBrowserOSPrefs({ 'browseros.server.proxy_port': 9512 })

    await expect(
      resolveBrowserOSMcpBaseUrl({
        query: 'http://127.0.0.1:9201',
        stored: 'http://127.0.0.1:9202',
        launcher: 'http://127.0.0.1:9203',
        fallback,
      }),
    ).resolves.toBe('http://127.0.0.1:9512')
  })

  it('falls back to trusted sources when the pref is invalid', async () => {
    installBrowserOSPrefs({ 'browseros.server.server_port': '9511' })

    await expect(
      resolveBrowserOSServerBaseUrl({
        query: null,
        stored: 'http://127.0.0.1:9202',
        launcher: 'http://127.0.0.1:9203',
        fallback,
      }),
    ).resolves.toBe('http://127.0.0.1:9202')
  })
})
