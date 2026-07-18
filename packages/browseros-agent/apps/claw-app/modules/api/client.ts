/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Generated BrowserClaw API client with dynamic loopback URL resolution.
 * One client is cached per resolved URL so switching BrowserOS's managed
 * server port immediately moves subsequent requests to the new server.
 */

import { Configuration, DefaultApi } from '@browseros/claw-api'
import {
  apiBaseUrlSourcesFromWindow,
  resolveBrowserOSServerBaseUrl,
} from './browseros-ports'
import { resolveApiBaseUrlFromSources } from './client.helpers'

export function apiBaseUrl(): string {
  return resolveApiBaseUrlFromSources(apiBaseUrlSourcesFromWindow())
}

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
