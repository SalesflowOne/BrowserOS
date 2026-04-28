/**
 * @license
 * Copyright 2025 BrowserOS
 */

import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FileTranscriptStore } from '../../../src/lib/agents/file-transcript-store'

describe('FileTranscriptStore', () => {
  const tempDirs: string[] = []

  afterEach(async () => {
    await Promise.all(
      tempDirs.map((dir) => rm(dir, { recursive: true, force: true })),
    )
    tempDirs.length = 0
  })

  it('appends and lists main-session transcript entries', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'browseros-transcripts-'))
    tempDirs.push(dir)
    const store = new FileTranscriptStore({ rootDir: dir })

    await store.append({
      agentId: 'agent-1',
      sessionId: 'main',
      role: 'user',
      text: 'hello',
    })
    await store.append({
      agentId: 'agent-1',
      sessionId: 'main',
      role: 'assistant',
      text: 'hi',
    })

    expect(
      (await store.list({ agentId: 'agent-1', sessionId: 'main' })).map(
        ({ role, text }) => ({ role, text }),
      ),
    ).toEqual([
      { role: 'user', text: 'hello' },
      { role: 'assistant', text: 'hi' },
    ])
  })
})
