/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import { DEFAULT_CONTROL_BASE_URL } from './constants'

export interface RemoteHermesEnv {
  baseUrl: string
  wsUrl: string
  jwtSecret: string | null
}

function deriveWsUrl(baseUrl: string): string {
  return `${baseUrl.replace(/^http/, 'ws').replace(/\/$/, '')}/v1/laptop/ws`
}

export function loadRemoteHermesEnv(): RemoteHermesEnv {
  const baseUrl = (
    process.env.CONTROL_BASE_URL ?? DEFAULT_CONTROL_BASE_URL
  ).replace(/\/$/, '')
  const jwtSecret = process.env.AGENT_RUNNER_JWT_SECRET ?? null
  return { baseUrl, wsUrl: deriveWsUrl(baseUrl), jwtSecret }
}

export class RemoteHermesNotConfiguredError extends Error {
  constructor() {
    super(
      'Remote Hermes is not configured. Set AGENT_RUNNER_JWT_SECRET in the server env.',
    )
    this.name = 'RemoteHermesNotConfiguredError'
  }
}

export function requireConfigured(
  env: RemoteHermesEnv,
): asserts env is RemoteHermesEnv & {
  jwtSecret: string
} {
  if (!env.jwtSecret) throw new RemoteHermesNotConfiguredError()
}
