import { Buffer } from 'node:buffer'
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { appDataDir } from '../../db/paths.js'

// Wrap Telegram bot tokens (and any future secrets) at rest with
// AES-256-GCM. The Electron host used `safeStorage` (OS keychain); the
// BrowserOS server has no keychain binding, so we derive a key from
// `COMPANY_SECRET_KEY` when set, otherwise from a randomly-generated
// 32-byte key file persisted under the app data dir (mode 0600).
//
// Output format: `v1:<base64(iv | authTag | ciphertext)>`. The version
// prefix lets us migrate the storage layer later.

const VERSION = 'v1'
const IV_BYTES = 12
const TAG_BYTES = 16
const KEY_FILE = 'secret.key'

let cachedKey: Buffer | null = null

function loadKey(): Buffer {
  if (cachedKey) return cachedKey
  // biome-ignore lint/style/noProcessEnv: server secret key is configured via env in production deployments
  const fromEnv = process.env.COMPANY_SECRET_KEY
  if (fromEnv && fromEnv.length > 0) {
    cachedKey = scryptSync(fromEnv, 'browseros-company-telegram', 32)
    return cachedKey
  }
  const dir = appDataDir()
  const keyPath = join(dir, KEY_FILE)
  if (existsSync(keyPath)) {
    cachedKey = readFileSync(keyPath)
    return cachedKey
  }
  mkdirSync(dir, { recursive: true })
  const key = randomBytes(32)
  writeFileSync(keyPath, key, { mode: 0o600 })
  cachedKey = key
  return cachedKey
}

export async function encryptSecret(plaintext: string): Promise<string> {
  const key = loadKey()
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ])
  const tag = cipher.getAuthTag()
  const payload = Buffer.concat([iv, tag, ciphertext])
  return `${VERSION}:${payload.toString('base64')}`
}

export async function decryptSecret(payload: string): Promise<string> {
  const parts = payload.split(':')
  if (parts.length !== 2 || parts[0] !== VERSION) {
    throw new Error('encrypted bot token payload has unexpected format')
  }
  const buf = Buffer.from(parts[1], 'base64')
  const iv = buf.subarray(0, IV_BYTES)
  const tag = buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES)
  const ciphertext = buf.subarray(IV_BYTES + TAG_BYTES)
  const key = loadKey()
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  const plaintext = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ])
  return plaintext.toString('utf8')
}
