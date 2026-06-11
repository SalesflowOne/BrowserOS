/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

export const IDLE_CLOSE_MS = 30 * 60 * 1000
export const IDLE_SWEEP_INTERVAL_MS = 5 * 60 * 1000
export const OPEN_DEADLINE_MS = 5_000
export const TURN_REFCOUNT_GUARD_MS = 10 * 60 * 1000
export const PING_INTERVAL_MS = 25_000
export const PONG_TIMEOUT_MS = 60_000
export const MAX_ENQUEUED_MESSAGES = 1_000
// DO sends 4001 when a newer connection for the same browserosId replaces
// us. partysocket would otherwise auto-reconnect into a flap-loop.
export const CLOSE_CODE_REPLACED = 4001
export const JWT_TTL_SEC = 60 * 60
export const REMOTE_HERMES_PROVIDER_TYPE = 'remote-hermes'
export const REMOTE_HERMES_AGENT_KIND = 'browseros-remote'
export const REMOTE_HERMES_DEFAULT_AGENT_ID = 'default'
export const WS_SUBPROTOCOL = 'browserclaw.v1'
export const DEFAULT_CONTROL_BASE_URL =
  'https://agent-control-worker.eng-6b4.workers.dev'
