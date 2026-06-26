/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { migrate } from 'drizzle-orm/bun-sqlite/migrator'
import { env } from '../../env'
import type { AuditDb } from './db'

interface DrizzleJournalEntry {
  tag: string
}

const sourceMigrationsFolder = resolve(import.meta.dir, '../../../drizzle')

/** Applies Claw audit DB migrations from packaged resources when available. */
export function runMigrations(db: AuditDb): void {
  migrate(db, { migrationsFolder: resolveMigrationsFolder() })
}

/** Resolves packaged migrations first, with source migrations as the dev/test fallback. */
export function resolveMigrationsFolder(
  resourcesDir = env.resourcesDir,
): string {
  const packaged = join(resourcesDir, 'db', 'migrations')
  if (hasCompleteMigrationSet(packaged)) return packaged
  return sourceMigrationsFolder
}

function hasCompleteMigrationSet(migrationsFolder: string): boolean {
  const sourceJournal = readDrizzleJournal(
    join(sourceMigrationsFolder, 'meta', '_journal.json'),
  )
  const candidateJournal = readDrizzleJournal(
    join(migrationsFolder, 'meta', '_journal.json'),
  )
  if (!sourceJournal || !candidateJournal) return false

  const candidateTags = new Set(
    candidateJournal.entries.map((entry) => entry.tag),
  )
  if (!sourceJournal.entries.every((entry) => candidateTags.has(entry.tag))) {
    return false
  }

  return candidateJournal.entries.every((entry) =>
    existsSync(join(migrationsFolder, `${entry.tag}.sql`)),
  )
}

function readDrizzleJournal(
  path: string,
): { entries: DrizzleJournalEntry[] } | null {
  if (!existsSync(path)) return null

  try {
    const journal = JSON.parse(readFileSync(path, 'utf8')) as unknown
    if (!isDrizzleJournal(journal)) return null
    return journal
  } catch {
    return null
  }
}

function isDrizzleJournal(
  value: unknown,
): value is { entries: DrizzleJournalEntry[] } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'entries' in value &&
    Array.isArray(value.entries) &&
    value.entries.every(
      (entry) =>
        typeof entry === 'object' &&
        entry !== null &&
        'tag' in entry &&
        typeof entry.tag === 'string',
    )
  )
}
