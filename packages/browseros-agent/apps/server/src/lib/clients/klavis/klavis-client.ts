/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { TIMEOUTS } from '@browseros/shared/constants/timeouts'
import { EXTERNAL_URLS } from '@browseros/shared/constants/urls'

export interface StrataCreateResponse {
  strataServerUrl: string
  strataId: string
  addedServers: string[]
  oauthUrls?: Record<string, string>
  apiKeyUrls?: Record<string, string>
}

interface KlavisIntegrationObject {
  name?: string
  isAuthenticated?: boolean
  is_authenticated?: boolean
}

type KlavisIntegrationItem = string | KlavisIntegrationObject

export interface UserIntegration {
  name: string
  isAuthenticated: boolean
}

interface SubmitApiKeyOptions {
  serverName?: string
  useAuthFieldOverrides?: boolean
}

const DEFAULT_AUTH_FIELD = 'api_key'

const AUTH_FIELD_OVERRIDES = new Map<string, string>([['discord', 'bot_token']])

const normalizeAuthServerName = (serverName: string): string =>
  serverName.toLowerCase().replace(/[^a-z0-9]+/g, '')

const getAuthFieldName = (
  serverName: string | undefined,
  useAuthFieldOverrides: boolean,
): string => {
  if (!serverName || !useAuthFieldOverrides) {
    return DEFAULT_AUTH_FIELD
  }
  return (
    AUTH_FIELD_OVERRIDES.get(normalizeAuthServerName(serverName)) ||
    DEFAULT_AUTH_FIELD
  )
}

const buildAuthData = (
  authFieldName: string,
  apiKey: string,
): Record<string, unknown> => {
  if (authFieldName === DEFAULT_AUTH_FIELD) {
    return { [DEFAULT_AUTH_FIELD]: apiKey }
  }
  return { data: { [authFieldName]: apiKey } }
}

export class KlavisClient {
  private baseUrl: string

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl || EXTERNAL_URLS.KLAVIS_PROXY
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const controller = new AbortController()
    const timeoutId = setTimeout(
      () => controller.abort(),
      TIMEOUTS.KLAVIS_FETCH,
    )

    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(
          `Klavis error: ${response.status} ${response.statusText} - ${errorText}`,
        )
      }

      return response.json()
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(
          `Klavis request timed out after ${TIMEOUTS.KLAVIS_FETCH}ms`,
        )
      }
      throw error
    } finally {
      clearTimeout(timeoutId)
    }
  }

  /**
   * Create Strata instance with specified servers
   * Returns strataServerUrl for MCP connection and oauthUrls for authentication
   */
  async createStrata(
    userId: string,
    servers: string[],
  ): Promise<StrataCreateResponse> {
    return this.request<StrataCreateResponse>(
      'POST',
      '/mcp-server/strata/create',
      { userId, servers },
    )
  }

  /**
   * Get user integrations with authentication status
   */
  async getUserIntegrations(userId: string): Promise<UserIntegration[]> {
    const data = await this.request<{
      integrations?: KlavisIntegrationItem[]
    }>('GET', `/user/${userId}/integrations`)
    const integrations = Array.isArray(data.integrations)
      ? data.integrations
      : []
    return integrations
      .map((integration) => this.normalizeIntegration(integration))
      .filter((integration): integration is UserIntegration =>
        Boolean(integration),
      )
  }

  private normalizeIntegration(
    integration: KlavisIntegrationItem,
  ): UserIntegration | null {
    if (typeof integration === 'string') {
      return { name: integration, isAuthenticated: true }
    }
    const name = integration.name
    if (!name || typeof name !== 'string') {
      return null
    }
    const isAuthenticated =
      typeof integration.isAuthenticated === 'boolean'
        ? integration.isAuthenticated
        : typeof integration.is_authenticated === 'boolean'
          ? integration.is_authenticated
          : false
    return { name, isAuthenticated }
  }

  /**
   * Submit an API key to Klavis's set-auth endpoint via the proxy.
   * Extracts instanceId from the apiKeyUrl and routes through the proxy.
   */
  async submitApiKey(
    apiKeyUrl: string,
    apiKey: string,
    options: SubmitApiKeyOptions = {},
  ): Promise<void> {
    const parsedUrl = new URL(apiKeyUrl)
    const instanceId = parsedUrl.searchParams.get('instance_id')
    if (!instanceId) {
      throw new Error('Missing instance_id in apiKeyUrl')
    }

    const authFieldName = getAuthFieldName(
      options.serverName,
      options.useAuthFieldOverrides ?? true,
    )

    // request() already throws on non-2xx responses
    await this.request('POST', '/mcp-server/instance/set-auth', {
      instanceId,
      authData: buildAuthData(authFieldName, apiKey),
    })
  }

  async deleteServersFromStrata(
    strataId: string,
    servers: string[],
  ): Promise<void> {
    const query = servers.map(encodeURIComponent).join(',')
    await this.request(
      'DELETE',
      `/mcp-server/strata/${strataId}/servers?servers=${query}`,
    )
  }
}
