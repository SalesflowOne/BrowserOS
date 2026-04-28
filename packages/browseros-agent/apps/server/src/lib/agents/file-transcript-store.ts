/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { randomUUID } from 'node:crypto'
import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { getBrowserosDir } from '../browseros-dir'
import type { AgentTranscriptEntry } from './agent-types'

export interface TranscriptListInput {
  agentId: string
  sessionId: 'main'
}

export interface TranscriptAppendInput {
  agentId: string
  sessionId: 'main'
  role: 'user' | 'assistant'
  text: string
}

export class FileTranscriptStore {
  private readonly rootDir: string

  constructor(options: { rootDir?: string } = {}) {
    this.rootDir =
      options.rootDir ??
      join(getBrowserosDir(), 'agents', 'harness', 'transcripts')
  }

  async append(input: TranscriptAppendInput): Promise<AgentTranscriptEntry> {
    const entry: AgentTranscriptEntry = {
      id: randomUUID(),
      agentId: input.agentId,
      sessionId: input.sessionId,
      role: input.role,
      text: input.text,
      createdAt: Date.now(),
    }
    const filePath = this.pathFor(input)
    await mkdir(dirname(filePath), { recursive: true })
    await appendFile(filePath, `${JSON.stringify(entry)}\n`, 'utf8')
    return entry
  }

  async list(input: TranscriptListInput): Promise<AgentTranscriptEntry[]> {
    try {
      const raw = await readFile(this.pathFor(input), 'utf8')
      return raw
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as AgentTranscriptEntry)
        .sort((a, b) => a.createdAt - b.createdAt)
    } catch (err) {
      if (isNotFoundError(err)) return []
      throw err
    }
  }

  private pathFor(input: TranscriptListInput): string {
    return join(this.rootDir, input.agentId, `${input.sessionId}.jsonl`)
  }
}

function isNotFoundError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    err.code === 'ENOENT'
  )
}
