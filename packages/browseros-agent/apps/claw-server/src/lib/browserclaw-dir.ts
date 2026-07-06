/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Resolves the on-disk BrowserClaw home the claw server reads and
 * writes under. BrowserClaw is a separate app from the BrowserOS
 * agent server, so it deliberately owns a separate home and env
 * override.
 *
 * Order of preference:
 *   1. `BROWSERCLAW_DIR` env override (read once via `env.ts`).
 *   2. `<homedir>/.browserclaw-dev` when `NODE_ENV === 'development'`.
 *   3. `<homedir>/.browserclaw` otherwise.
 *
 * Legacy shipped builds wrote under `<BrowserOS home>/claw-server`.
 * Startup migrates that default path to the BrowserClaw home when it
 * is safe to do so.
 */

import { constants } from 'node:fs'
import { access, cp, rename, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { PATHS } from '@browseros/shared/constants/paths'
import { env } from '../env'

const LEGACY_CLAW_SERVER_SUBDIR = 'claw-server'

export type LegacyClawServerHomeMigrationResult =
  | {
      status: 'migrated'
      from: string
      to: string
    }
  | {
      status: 'skipped'
      reason: 'custom-override' | 'legacy-missing' | 'target-exists'
      from: string
      to: string
    }

export interface LegacyClawServerHomeMigrationOptions {
  from?: string
  to?: string
}

export function getBrowserClawDir(): string {
  if (env.browserclawDirOverride) return env.browserclawDirOverride
  const dirName = env.isDevelopment
    ? PATHS.DEV_BROWSERCLAW_DIR_NAME
    : PATHS.BROWSERCLAW_DIR_NAME
  return join(homedir(), dirName)
}

function getLegacyClawServerDir(): string {
  const dirName = env.isDevelopment
    ? PATHS.DEV_BROWSEROS_DIR_NAME
    : PATHS.BROWSEROS_DIR_NAME
  return join(homedir(), dirName, LEGACY_CLAW_SERVER_SUBDIR)
}

/** BrowserClaw home, the root for this package's files. */
export function getClawServerDir(): string {
  return getBrowserClawDir()
}

/** Convenience: any relative path resolved against the BrowserClaw home. */
export function resolveClawServerPath(...segments: string[]): string {
  return join(getClawServerDir(), ...segments)
}

export async function migrateLegacyClawServerHome(
  options: LegacyClawServerHomeMigrationOptions = {},
): Promise<LegacyClawServerHomeMigrationResult> {
  const from = options.from ?? getLegacyClawServerDir()
  const to = options.to ?? getClawServerDir()
  const usingDefaultPaths =
    options.from === undefined && options.to === undefined

  if (usingDefaultPaths && env.browserclawDirOverride) {
    return { status: 'skipped', reason: 'custom-override', from, to }
  }
  if (await pathExists(to)) {
    return { status: 'skipped', reason: 'target-exists', from, to }
  }
  if (!(await pathExists(from))) {
    return { status: 'skipped', reason: 'legacy-missing', from, to }
  }

  try {
    await rename(from, to)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code !== 'EXDEV') {
      throw new Error(formatMigrationError(from, to, error))
    }
    const tempTo = join(
      dirname(to),
      `.browserclaw-migration-${process.pid}-${Date.now()}-${Math.random()
        .toString(16)
        .slice(2)}`,
    )

    try {
      await cp(from, tempTo, {
        recursive: true,
        errorOnExist: true,
        force: false,
      })
      await rename(tempTo, to)
    } catch (copyError) {
      await rm(tempTo, { recursive: true, force: true }).catch(() => {})
      throw new Error(formatMigrationError(from, to, copyError))
    }
    // If the process dies after the final rename but before rm, both homes
    // remain. The next startup keeps the new BrowserClaw home and leaves the
    // legacy copy untouched rather than deleting a possibly divergent source.
    await rm(from, { recursive: true, force: false })
  }

  return { status: 'migrated', from, to }
}

function formatMigrationError(
  from: string,
  to: string,
  error: unknown,
): string {
  return `Failed to migrate legacy claw-server home from ${from} to ${to}: ${
    error instanceof Error ? error.message : String(error)
  }`
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK)
    return true
  } catch {
    return false
  }
}
