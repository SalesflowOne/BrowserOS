export * from './generated/index.js'

export const CLAW_API_PORT_DEFAULT = 9200
export const MCP_PATH = '/mcp'
export const BROWSEROS_MCP_SERVER_NAME = 'BrowserClaw'

export function canonicalMcpUrlForPort(port = CLAW_API_PORT_DEFAULT): string {
  return `http://127.0.0.1:${port}${MCP_PATH}`
}
