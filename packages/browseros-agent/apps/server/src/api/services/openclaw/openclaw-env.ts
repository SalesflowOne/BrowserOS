/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { join } from 'node:path'
import {
  OPENCLAW_CONTAINER_HOME,
  OPENCLAW_GATEWAY_PORT,
} from '@browseros/shared/constants/openclaw'

const OPENCLAW_IMAGE = 'ghcr.io/openclaw/openclaw:latest'
const STATE_DIR_NAME = '.openclaw'

export const BUILTIN_PROVIDER_ENV_MAP: Record<string, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  moonshot: 'MOONSHOT_API_KEY',
}

export interface OpenClawProviderInput {
  providerType?: string
  providerName?: string
  baseUrl?: string
  modelId?: string
  apiKey?: string
}

export interface ResolvedOpenClawProvider {
  envValues: Record<string, string>
  model?: string
}

export function getOpenClawStateDir(openclawDir: string): string {
  return join(openclawDir, STATE_DIR_NAME)
}

export function getOpenClawStateConfigPath(openclawDir: string): string {
  return join(getOpenClawStateDir(openclawDir), 'openclaw.json')
}

export function getOpenClawStateEnvPath(openclawDir: string): string {
  return join(getOpenClawStateDir(openclawDir), '.env')
}

export function getHostWorkspaceDir(
  openclawDir: string,
  agentName: string,
): string {
  return join(
    getOpenClawStateDir(openclawDir),
    agentName === 'main' ? 'workspace' : `workspace-${agentName}`,
  )
}

export function buildComposeEnvFile(input: {
  hostHome: string
  image?: string
  port?: number
  timezone?: string
}): string {
  return [
    `OPENCLAW_IMAGE=${input.image ?? OPENCLAW_IMAGE}`,
    `OPENCLAW_GATEWAY_PORT=${input.port ?? OPENCLAW_GATEWAY_PORT}`,
    `OPENCLAW_HOST_HOME=${input.hostHome}`,
    `TZ=${input.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone}`,
    '',
  ].join('\n')
}

export function mergeEnvContent(
  current: string,
  updates: Record<string, string>,
): { changed: boolean; content: string } {
  if (Object.keys(updates).length === 0) {
    return {
      changed: false,
      content: normalizeEnvContent(current),
    }
  }

  const lines = current === '' ? [] : current.replace(/\r\n/g, '\n').split('\n')
  const nextLines = [...lines]
  let changed = false

  for (const [key, value] of Object.entries(updates)) {
    const replacement = `${key}=${value}`
    const index = nextLines.findIndex((line) => line.startsWith(`${key}=`))
    if (index === -1) {
      nextLines.push(replacement)
      changed = true
      continue
    }
    if (nextLines[index] === replacement) {
      continue
    }
    nextLines[index] = replacement
    changed = true
  }

  const content = normalizeEnvContent(nextLines.join('\n'))
  return {
    changed: changed || content !== normalizeEnvContent(current),
    content,
  }
}

export function resolveOpenClawProvider(
  input: OpenClawProviderInput,
): ResolvedOpenClawProvider {
  if (!input.providerType) {
    return { envValues: {} }
  }

  if (input.providerType in BUILTIN_PROVIDER_ENV_MAP) {
    const envVar = BUILTIN_PROVIDER_ENV_MAP[input.providerType]
    const envValues = input.apiKey && envVar ? { [envVar]: input.apiKey } : {}

    return {
      envValues,
      model: input.modelId
        ? `${input.providerType}/${input.modelId}`
        : undefined,
    }
  }

  return {
    envValues: {},
  }
}

function normalizeEnvContent(content: string): string {
  const trimmed = content.trim()
  return trimmed ? `${trimmed}\n` : ''
}

/**
 * OpenRouter public model slugs can include dots, but OpenClaw's registry keys
 * for those models use dashes instead.
 */
export { OPENCLAW_CONTAINER_HOME }
