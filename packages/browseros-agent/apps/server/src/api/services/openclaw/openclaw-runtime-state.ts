/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export interface OpenClawRuntimeState {
  hostGatewayPort: number | null
  lastSuccessfulStartAt: string | null
  repairGeneration: number
  lastRepairOutcome: 'success' | 'failed' | null
}

const RUNTIME_STATE_FILE_NAME = 'runtime-state.json'

export function getOpenClawRuntimeStatePath(openclawDir: string): string {
  return join(openclawDir, RUNTIME_STATE_FILE_NAME)
}

export async function loadOpenClawRuntimeState(
  openclawDir: string,
): Promise<OpenClawRuntimeState | null> {
  try {
    const parsed = JSON.parse(
      await readFile(getOpenClawRuntimeStatePath(openclawDir), 'utf-8'),
    ) as unknown
    if (!isOpenClawRuntimeState(parsed)) return null
    return parsed
  } catch {
    return null
  }
}

export async function saveOpenClawRuntimeState(
  openclawDir: string,
  state: OpenClawRuntimeState,
): Promise<void> {
  await mkdir(openclawDir, { recursive: true })
  await writeFile(
    getOpenClawRuntimeStatePath(openclawDir),
    `${JSON.stringify(state, null, 2)}\n`,
    'utf-8',
  )
}

function isOpenClawRuntimeState(value: unknown): value is OpenClawRuntimeState {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }

  const state = value as Record<string, unknown>
  return (
    (typeof state.hostGatewayPort === 'number' ||
      state.hostGatewayPort === null) &&
    (typeof state.lastSuccessfulStartAt === 'string' ||
      state.lastSuccessfulStartAt === null) &&
    typeof state.repairGeneration === 'number' &&
    (state.lastRepairOutcome === 'success' ||
      state.lastRepairOutcome === 'failed' ||
      state.lastRepairOutcome === null)
  )
}
