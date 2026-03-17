/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Centralized external service URLs.
 */

export const EXTERNAL_URLS = {
  KLAVIS_PROXY: 'https://llm.browseros.com/klavis',
  POSTHOG_DEFAULT: 'https://us.i.posthog.com',
  CODEGEN_SERVICE: 'https://graph.browseros.com',
  OPENAI_AUTH: 'https://auth.openai.com/oauth/authorize',
  OPENAI_TOKEN: 'https://auth.openai.com/oauth/token',
  SKILLS_CATALOG: 'https://cdn.browseros.com/skills/v1/catalog.json',
} as const
