/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Generated BrowserClaw API client (`DefaultApi` from
 * `@browseros/claw-api`); calls go over HTTP loopback to whichever
 * port the claw server bound to.
 *
 * Base URL resolution order:
 *   1. BrowserOS `browseros.server.server_port` pref
 *   2. `?apiUrl=…` on window.location (dev launcher publishes this)
 *   3. sessionStorage cache of (2)
 *   4. VITE_BROWSEROS_CLAW_API_URL from the dev watcher
 *   5. standalone BrowserClaw port on 127.0.0.1
 *
 * (1) comes from BrowserOS's callback-based pref API, so the full
 * chain is async. `apiClient()` re-resolves on every call and swaps
 * the cached client when the resolved URL changes, so a managed-port
 * change moves subsequent requests to the new server without a reload.
 */

import { Configuration, DefaultApi } from '@browseros/claw-api'
import {
  apiBaseUrlSourcesFromWindow,
  resolveBrowserOSServerBaseUrl,
} from './browseros-ports'
import { resolveApiBaseUrlFromSources } from './client.helpers'

/**
 * Sync resolution over the trusted local sources — steps 2-5 only; the
 * BrowserOS pref is callback-based and needs `resolveApiBaseUrl`. For
 * surfaces that embed the resolved base URL directly (eg. an
 * `<img src>` to a binary screenshot route) rather than going through
 * the JSON client.
 */
export function apiBaseUrl(): string {
  return resolveApiBaseUrlFromSources(apiBaseUrlSourcesFromWindow())
}

/** Full resolution, BrowserOS server-port pref included. */
export async function resolveApiBaseUrl(): Promise<string> {
  return resolveBrowserOSServerBaseUrl(apiBaseUrlSourcesFromWindow())
}

let cachedBase: string | null = null
let cachedClient: DefaultApi | null = null

export function apiClientForBaseUrl(baseUrl: string): DefaultApi {
  if (baseUrl !== cachedBase || !cachedClient) {
    cachedBase = baseUrl
    cachedClient = new DefaultApi(new Configuration({ basePath: baseUrl }))
  }
  return cachedClient
}

export async function apiClient(): Promise<DefaultApi> {
  return apiClientForBaseUrl(await resolveApiBaseUrl())
}
