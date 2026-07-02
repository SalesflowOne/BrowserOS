/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { afterEach, describe, expect, test } from 'bun:test'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { logger } from '../../src/lib/logger'

const LOG_NAME = 'claw-server.log'
const tempDirs: string[] = []

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'claw-logger-'))
  tempDirs.push(dir)
  return dir
}

function readLines(logPath: string): Array<Record<string, unknown>> {
  return readFileSync(logPath, 'utf8')
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line))
}

afterEach(() => {
  logger.closeLogFile()
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('logger.setLogFile', () => {
  test('writes JSON lines with pino-shaped fields to the log file', () => {
    const dir = makeTempDir()
    logger.setLogFile(dir)

    logger.info('hello file', { url: 'http://127.0.0.1:1234' })
    logger.error('boom')

    const lines = readLines(join(dir, LOG_NAME))
    expect(lines).toHaveLength(2)
    expect(lines[0]).toMatchObject({
      level: 30,
      msg: 'hello file',
      url: 'http://127.0.0.1:1234',
    })
    expect(typeof lines[0]?.time).toBe('number')
    expect(lines[1]).toMatchObject({ level: 50, msg: 'boom' })
  })

  test('creates the log directory when missing', () => {
    const dir = join(makeTempDir(), 'nested', 'claw-server')
    logger.setLogFile(dir)

    logger.info('created')

    expect(existsSync(join(dir, LOG_NAME))).toBe(true)
  })

  test('appends to a fresh log file without rotating', () => {
    const dir = makeTempDir()
    const logPath = join(dir, LOG_NAME)
    writeFileSync(logPath, '{"level":30,"msg":"previous run"}\n')

    logger.setLogFile(dir)
    logger.info('next run')

    expect(existsSync(`${logPath}.old`)).toBe(false)
    const lines = readLines(logPath)
    expect(lines).toHaveLength(2)
    expect(lines[1]).toMatchObject({ msg: 'next run' })
  })

  test('rotates a stale log file to .old and starts fresh', () => {
    const dir = makeTempDir()
    const logPath = join(dir, LOG_NAME)
    writeFileSync(logPath, '{"level":30,"msg":"stale"}\n')
    const staleSeconds = (Date.now() - 25 * 60 * 60 * 1000) / 1000
    utimesSync(logPath, staleSeconds, staleSeconds)

    logger.setLogFile(dir)
    logger.info('fresh')

    const backup = readLines(`${logPath}.old`)
    expect(backup[0]).toMatchObject({ msg: 'stale' })
    const lines = readLines(logPath)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({ msg: 'fresh' })
  })

  test('replaces an existing .old backup on rotation', () => {
    const dir = makeTempDir()
    const logPath = join(dir, LOG_NAME)
    writeFileSync(`${logPath}.old`, '{"level":30,"msg":"ancient"}\n')
    writeFileSync(logPath, '{"level":30,"msg":"stale"}\n')
    const staleSeconds = (Date.now() - 25 * 60 * 60 * 1000) / 1000
    utimesSync(logPath, staleSeconds, staleSeconds)

    logger.setLogFile(dir)

    const backup = readLines(`${logPath}.old`)
    expect(backup).toHaveLength(1)
    expect(backup[0]).toMatchObject({ msg: 'stale' })
  })

  test('does not throw when the log dir is unwritable', () => {
    const dir = join(makeTempDir(), 'blocked')
    // A file where the directory should be makes mkdir fail
    writeFileSync(dir, 'not a directory')

    expect(() => logger.setLogFile(dir)).not.toThrow()
    expect(() => logger.info('stderr only')).not.toThrow()
  })

  test('re-pointing the sink switches files', () => {
    const first = makeTempDir()
    const second = makeTempDir()

    logger.setLogFile(first)
    logger.info('one')
    logger.setLogFile(second)
    logger.info('two')

    expect(readLines(join(first, LOG_NAME))).toHaveLength(1)
    const lines = readLines(join(second, LOG_NAME))
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({ msg: 'two' })
  })
})
