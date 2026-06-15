import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { BROWSEROS_PREFS } from './prefs'

const prefRequests: string[] = []

mock.module('./adapter', () => ({
  BrowserOSAdapter: {
    getInstance: () => ({
      getPref: async (name: string) => {
        prefRequests.push(name)
        return name === BROWSEROS_PREFS.MCP_PORT
          ? { value: 9105 }
          : { value: null }
      },
      getBrowserosVersion: async () => null,
    }),
  },
  getBrowserOSAdapter: () => ({
    getPref: async (name: string) => {
      prefRequests.push(name)
      return name === BROWSEROS_PREFS.MCP_PORT
        ? { value: 9105 }
        : { value: null }
    },
  }),
}))

describe('getAgentServerUrl', () => {
  beforeEach(() => {
    prefRequests.length = 0
  })

  it('uses the BrowserOS MCP port as the server URL', async () => {
    const { getAgentServerUrl } = await import('./helpers')

    await expect(getAgentServerUrl()).resolves.toBe('http://127.0.0.1:9105')
    expect(prefRequests).toContain(BROWSEROS_PREFS.MCP_PORT)
    expect(prefRequests).not.toContain('browseros.server.agent_port')
  })
})
