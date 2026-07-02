/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Structured JSON logger. Writes one event per line to stderr so
 * downstream log shippers can `tail -F` without competing with
 * stdout traffic. The shape matches @browseros/server's pino output
 * (level, time, msg, plus arbitrary structured fields) so existing
 * log views render both producers identically.
 *
 * `setLogFile` adds an optional file sink with the same startup-time
 * 24h rotation as @browseros/server (rename to `.old` when stale) so
 * prod runs keep an on-disk record. Deliberately dep-free: pino's
 * async transports bring Bun-compile caveats, and at this log volume
 * sync per-line writes are fine — and survive crashes, which is when
 * the file matters most.
 */

import fs from 'node:fs'
import path from 'node:path'

const LOG_FILE_NAME = 'claw-server.log'
const LOG_FILE_MAX_AGE_MS = 24 * 60 * 60 * 1000 // 1 day

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
}

let fileFd: number | null = null

/**
 * Rotate the log file if it's older than max age. Startup-time only:
 * deletes the previous backup and renames current to `.old`.
 */
function rotateLogIfNeeded(logPath: string): void {
  try {
    const stat = fs.statSync(logPath)
    const ageMs = Date.now() - stat.mtimeMs

    if (ageMs > LOG_FILE_MAX_AGE_MS) {
      const backupPath = `${logPath}.old`
      try {
        fs.unlinkSync(backupPath)
      } catch {
        // Backup doesn't exist, that's fine
      }
      fs.renameSync(logPath, backupPath)
    }
  } catch {
    // File doesn't exist, nothing to rotate
  }
}

function closeLogFile(): void {
  if (fileFd === null) return
  const fd = fileFd
  fileFd = null
  try {
    fs.closeSync(fd)
  } catch {
    // Already closed or invalid; sink is detached either way
  }
}

/**
 * Point the file sink at `<logDir>/claw-server.log`, rotating a stale
 * file first. Never throws: on any failure the logger stays
 * stderr-only, because a broken log dir must not take the server down.
 */
function setLogFile(logDir: string): void {
  closeLogFile()
  const logPath = path.join(logDir, LOG_FILE_NAME)
  try {
    fs.mkdirSync(logDir, { recursive: true })
    rotateLogIfNeeded(logPath)
    fileFd = fs.openSync(logPath, 'a')
  } catch (error) {
    write('warn', 'file logging disabled: could not open log file', {
      logPath,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

function write(level: LogLevel, msg: string, fields?: Record<string, unknown>) {
  const event = {
    level: LEVEL_PRIORITY[level],
    time: Date.now(),
    msg,
    ...fields,
  }
  const line = JSON.stringify(event)
  // biome-ignore lint/suspicious/noConsole: logger is the sanctioned console wrapper for the package
  console.error(line)
  if (fileFd !== null) {
    try {
      fs.writeSync(fileFd, `${line}\n`)
    } catch {
      // Dead sink (disk full, fd invalidated): detach so every later
      // log call doesn't re-fail; stderr keeps working.
      closeLogFile()
    }
  }
}

export const logger = {
  debug: (msg: string, fields?: Record<string, unknown>) =>
    write('debug', msg, fields),
  info: (msg: string, fields?: Record<string, unknown>) =>
    write('info', msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>) =>
    write('warn', msg, fields),
  error: (msg: string, fields?: Record<string, unknown>) =>
    write('error', msg, fields),
  setLogFile,
  closeLogFile,
}
