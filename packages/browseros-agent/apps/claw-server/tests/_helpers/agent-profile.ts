/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { toSlug } from '../../src/lib/slug'
import { writeJson } from '../../src/lib/storage'
import {
  type StoredAgentProfile,
  storedAgentProfileSchema,
} from '../../src/routes/agents/schemas'
import { publicMcpUrl } from '../../src/shared/mcp-url'

export function makeStoredAgentProfile(
  overrides: Partial<StoredAgentProfile> = {},
): StoredAgentProfile {
  const slug = overrides.slug ?? toSlug(overrides.name ?? 'Finance Ops')
  const id = overrides.id ?? slug
  return {
    id,
    name: 'Finance Ops',
    harness: 'Claude Desktop',
    loginMode: 'profile',
    selectedSites: [],
    approvals: {
      submit: 'Ask',
      payment: 'Block',
      delete: 'Ask',
      upload: 'Ask',
      navigate: 'Auto',
      input: 'Auto',
    },
    aclRuleIds: [],
    customAclRules: [],
    slug,
    mcpUrl: publicMcpUrl(),
    status: 'configured',
    createdAt: '2026-07-06T00:00:00.000Z',
    updatedAt: '2026-07-06T00:00:00.000Z',
    ...overrides,
  }
}

export async function writeAgentProfile(
  overrides: Partial<StoredAgentProfile> = {},
): Promise<StoredAgentProfile> {
  const profile = makeStoredAgentProfile(overrides)
  await writeJson(
    `agents/${profile.id}.json`,
    profile,
    storedAgentProfileSchema,
  )
  return profile
}
