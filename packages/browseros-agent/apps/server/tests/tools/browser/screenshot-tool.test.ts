import { describe, expect, it } from 'bun:test'
import type {
  ScreenshotCaptureOptions,
  ScreenshotCaptureResult,
} from '../../../src/browser/core/screenshot'
import type { BrowserSession } from '../../../src/browser/core/session'
import { executeTool } from '../../../src/tools/browser/framework'
import { screenshot } from '../../../src/tools/browser/screenshot'

describe('screenshot tool', () => {
  it('defaults annotate to true and returns inline PNG content', async () => {
    let captured:
      | { page: number; options: ScreenshotCaptureOptions }
      | undefined
    const session = {
      screenshot: async (page: number, options: ScreenshotCaptureOptions) => {
        captured = { page, options }
        return {
          data: 'png-data',
          mimeType: 'image/png',
          annotations: [
            {
              ref: 'e1',
              number: 1,
              role: 'button',
              name: 'Save',
              box: { x: 1, y: 2, width: 3, height: 4 },
            },
          ],
        } satisfies ScreenshotCaptureResult
      },
      pages: {
        getTabId: () => undefined,
      },
    } as unknown as BrowserSession

    const result = await executeTool(screenshot, { page: 3 }, { session })

    expect(captured).toEqual({
      page: 3,
      options: { format: 'png', fullPage: false, annotate: true },
    })
    expect(result.content).toEqual([
      { type: 'image', data: 'png-data', mimeType: 'image/png' },
    ])
    expect(result.structuredContent).toEqual({
      page: 3,
      annotations: [
        {
          ref: 'e1',
          number: 1,
          role: 'button',
          name: 'Save',
          box: { x: 1, y: 2, width: 3, height: 4 },
        },
      ],
    })
  })

  it('passes annotate false through to the browser session', async () => {
    let captured:
      | { page: number; options: ScreenshotCaptureOptions }
      | undefined
    const session = {
      screenshot: async (page: number, options: ScreenshotCaptureOptions) => {
        captured = { page, options }
        return {
          data: 'png-data',
          mimeType: 'image/png',
          annotations: [],
        } satisfies ScreenshotCaptureResult
      },
      pages: {
        getTabId: () => undefined,
      },
    } as unknown as BrowserSession

    const result = await executeTool(
      screenshot,
      { page: 3, fullPage: true, annotate: false },
      { session },
    )

    expect(captured).toEqual({
      page: 3,
      options: { format: 'png', fullPage: true, annotate: false },
    })
    expect(result.content).toEqual([
      { type: 'image', data: 'png-data', mimeType: 'image/png' },
    ])
    expect(result.structuredContent).toBeUndefined()
  })
})
