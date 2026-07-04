import { describe, expect, it } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BrowserSession } from '@browseros/browser-core/core/session'
import { TOOL_LIMITS } from '@browseros/shared/constants/limits'
import { executeTool } from './framework'
import { grep } from './grep'

function sessionWithSnapshot(text: string): BrowserSession {
  return {
    observe: () => ({ snapshot: async () => ({ text }) }),
    pages: { getInfo: () => ({ url: 'https://example.com' }) },
  } as unknown as BrowserSession
}

function textOf(result: { content?: unknown } | undefined): string {
  if (!Array.isArray(result?.content)) return ''
  return result.content
    .filter(
      (item): item is { type: 'text'; text: string } =>
        typeof item === 'object' &&
        item !== null &&
        'type' in item &&
        item.type === 'text' &&
        'text' in item &&
        typeof item.text === 'string',
    )
    .map((item) => item.text)
    .join('\n')
}

async function withBrowserosDir<T>(run: () => Promise<T>): Promise<T> {
  const previous = process.env.BROWSEROS_DIR
  const browserosDir = mkdtempSync(join(tmpdir(), 'grep-test-'))
  process.env.BROWSEROS_DIR = browserosDir
  try {
    return await run()
  } finally {
    if (previous === undefined) {
      delete process.env.BROWSEROS_DIR
    } else {
      process.env.BROWSEROS_DIR = previous
    }
    rmSync(browserosDir, { recursive: true, force: true })
  }
}

describe('grep tool', () => {
  it('returns small matches with metadata-only structured output', async () => {
    const result = await executeTool(
      grep,
      { page: 4, pattern: 'save', over: 'ax' },
      {
        session: sessionWithSnapshot(
          'button "Save" [ref=e1]\nlink "Home"\nbutton "Save draft" [ref=e2]',
        ),
      },
    )

    expect(result.isError).toBeFalsy()
    expect(result.structuredContent).toEqual({
      page: 4,
      over: 'ax',
      count: 2,
    })
    expect(result.structuredContent).not.toHaveProperty('matches')
    expect(textOf(result)).toContain('button "Save" [ref=e1]')
  })

  it('reports zero matches without a matches array', async () => {
    const result = await executeTool(
      grep,
      { page: 4, pattern: 'checkout', over: 'ax' },
      { session: sessionWithSnapshot('link "Home"\nlink "About"') },
    )

    expect(result.isError).toBeFalsy()
    expect(result.structuredContent).toEqual({
      page: 4,
      over: 'ax',
      count: 0,
    })
  })

  it('clamps pathological single-line matches and spills the full line', async () => {
    await withBrowserosDir(async () => {
      const tail = 'tail-marker'
      const line = `needle ${'x'.repeat(100_000)} ${tail}`
      const result = await executeTool(
        grep,
        { page: 4, pattern: 'needle', over: 'ax' },
        { session: sessionWithSnapshot(line) },
      )
      const data = result.structuredContent as
        | {
            page: number
            over: string
            count: number
            truncated: boolean
            path: string
          }
        | undefined
      const text = textOf(result)
      const renderedLine = text.split('\n')[1] ?? ''

      expect(result.isError).toBeFalsy()
      expect(data).toMatchObject({
        page: 4,
        over: 'ax',
        count: 1,
        truncated: true,
      })
      const path = data?.path
      expect(typeof path).toBe('string')
      if (typeof path !== 'string') throw new Error('expected output path')
      expect(data).not.toHaveProperty('matches')
      expect(renderedLine.length).toBeLessThanOrEqual(
        TOOL_LIMITS.GREP_MATCH_LINE_MAX_CHARS,
      )
      expect(renderedLine).toContain('... [truncated]')
      expect(text).toContain(path)
      expect(text).not.toContain(tail)
      expect(readFileSync(path, 'utf8')).toContain(tail)
    })
  })

  it('clamps requested limits to the shared maximum', async () => {
    const haystack = Array.from(
      { length: TOOL_LIMITS.GREP_MAX_MATCHES + 5 },
      (_, index) => `match ${index}`,
    ).join('\n')
    const result = await executeTool(
      grep,
      {
        page: 4,
        pattern: 'match',
        over: 'ax',
        limit: TOOL_LIMITS.GREP_MAX_MATCHES + 100,
      },
      { session: sessionWithSnapshot(haystack) },
    )

    expect(result.isError).toBeFalsy()
    expect(result.structuredContent).toEqual({
      page: 4,
      over: 'ax',
      count: TOOL_LIMITS.GREP_MAX_MATCHES,
    })
    expect(textOf(result)).toContain(
      `match ${TOOL_LIMITS.GREP_MAX_MATCHES - 1}`,
    )
    expect(textOf(result)).not.toContain(
      `match ${TOOL_LIMITS.GREP_MAX_MATCHES}`,
    )
  })
})
