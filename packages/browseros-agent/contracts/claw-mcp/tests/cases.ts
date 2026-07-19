/**
 * The behavioral half of the claw-mcp contract: every case runs
 * verbatim against both servers' `/mcp` over real HTTP with a real
 * BrowserOS attached, asserting observable tool behavior only. A case
 * that passes on one server and fails on the other is a contract
 * violation unless the difference is registered in divergences.ts.
 *
 * CASE ORDER IS LOAD-BEARING: cases run sequentially per server in
 * array order against one shared browser profile. State-poisoning
 * cases (killing the browser) must stay last; cases that open dialogs
 * or pages clean them up before returning.
 */

import type { BrowserHandle } from './browser'
import type { McpSession } from './mcp-client'
import type { ContractServer } from './server-adapters'

export const CASE_TIMEOUT_MS = 180_000

export interface CaseContext {
  server: ContractServer
  browser: BrowserHandle
  /** Primary MCP session, shared across cases within one server run. */
  mcp: McpSession
  /** Extra sessions (ownership/naming/audit cases); auto-closed at run end. */
  openSession(clientName?: string): Promise<McpSession>
  /** URL on the primary fixture origin. */
  fixture(path: string): string
  /** URL on the secondary fixture origin (cross-origin iframes). */
  fixture2(path: string): string
  /** `tabs new` on the given session (default primary); returns the page id and tracks it for post-case cleanup. */
  openPage(url: string, session?: McpSession): Promise<number>
  /** Parity signature under a stable key; tag a divergence id to exempt it from equality. */
  record(key: string, value: unknown, options?: { divergence?: string }): void
  scratchDir: string
}

export interface ContractCase {
  name: string
  /** ~12 cases carry true: the <60s tier run by test:claw-mcp-smoke. */
  smoke?: boolean
  run(ctx: CaseContext): Promise<void>
}

import { tabsCases } from './cases-tabs'
import { transportCases } from './cases-transport'

export const contractCases: ContractCase[] = [...transportCases, ...tabsCases]
