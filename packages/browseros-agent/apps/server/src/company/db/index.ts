import { existsSync } from 'node:fs'
import { copyFile, mkdir, rename, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { type Client, createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import { migrate } from 'drizzle-orm/libsql/migrator'
import { appDataDir } from './paths.js'
import * as schema from './schema/schema.js'

const APP_DIR = appDataDir()
const DB_PATH = join(APP_DIR, 'data.db')
const BACKUP_PATH = `${DB_PATH}.backup`

// Migrations live at src/company/drizzle, a sibling of this db/ folder.
function migrationsFolder(): string {
  return join(import.meta.dirname, '..', 'drizzle')
}

import type { DB } from './types.js'

export type Opened = {
  client: Client
  db: DB
}

async function open(): Promise<Opened> {
  const client = createClient({ url: `file:${DB_PATH}` })
  await client.execute('PRAGMA journal_mode = WAL')
  return { client, db: drizzle(client, { schema }) }
}

export async function initializeDatabase(): Promise<Opened> {
  await mkdir(APP_DIR, { recursive: true })
  if (existsSync(DB_PATH)) await copyFile(DB_PATH, BACKUP_PATH)

  const opened = await open()
  try {
    await migrate(opened.db, { migrationsFolder: migrationsFolder() })
    if (existsSync(BACKUP_PATH)) await unlink(BACKUP_PATH)
    return opened
  } catch (err) {
    opened.client.close()
    if (existsSync(BACKUP_PATH)) await rename(BACKUP_PATH, DB_PATH)
    // biome-ignore lint/suspicious/noConsole: surface migration failures at boot — only place a logger isn't yet wired
    console.error('migration failed, restored from backup', err)
    return open()
  }
}

export type { DB } from './types.js'
