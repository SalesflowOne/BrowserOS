/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { EXTERNAL_URLS } from '@browseros/shared/constants/urls'

export interface OAuthProviderConfig {
  id: string
  name: string
  clientId: string
  authEndpoint: string
  tokenEndpoint: string
  scopes: string[]
  extraAuthParams?: Record<string, string>
  upstreamLLMProvider: string
}

export const OAUTH_PROVIDERS: Record<string, OAuthProviderConfig> = {
  'chatgpt-pro': {
    id: 'chatgpt-pro',
    name: 'ChatGPT Plus/Pro',
    clientId: 'app_EMoamEEZ73f0CkXaXp7hrann',
    authEndpoint: EXTERNAL_URLS.OPENAI_AUTH,
    tokenEndpoint: EXTERNAL_URLS.OPENAI_TOKEN,
    scopes: ['openid', 'profile', 'email', 'offline_access'],
    extraAuthParams: {
      id_token_add_organizations: 'true',
      codex_cli_simplified_flow: 'true',
      originator: 'browseros',
    },
    upstreamLLMProvider: 'openai',
  },
}

export function getOAuthProvider(
  providerId: string,
): OAuthProviderConfig | undefined {
  return OAUTH_PROVIDERS[providerId]
}
