import type { DB } from '../db/types.js'

let _db: DB | null = null

export function setDb(db: DB): void {
  _db = db
}

export function getDb(): DB {
  if (!_db) throw new Error('db not initialised')
  return _db
}
