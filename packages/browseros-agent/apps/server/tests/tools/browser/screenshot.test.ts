import { describe, expect, it } from 'bun:test'
import {
  captureScreenshotWithAnnotations,
  type ScreenshotCaptureOptions,
} from '../../../src/browser/core/screenshot'
import type { BrowserSession } from '../../../src/browser/core/session'
import { RefMap } from '../../../src/browser/core/snapshot/refs'
import { executeTool } from '../../../src/tools/browser/framework'
import { screenshot } from '../../../src/tools/browser/screenshot'

function createRefs(): RefMap {
  const refs = new RefMap()
  refs.mint({
    backendNodeId: 101,
    role: 'button',
    name: 'Save',
    documentId: 'doc-1',
  })
  return refs
}

function createHarness(
  options: {
    rect?: { x: number; y: number; width: number; height: number }
    rejectCapture?: boolean
  } = {},
) {
  const events: string[] = []
  const expressions: string[] = []
  const refs = createRefs()
  const pageSession = {
    DOM: {
      resolveNode: async ({ backendNodeId }: { backendNodeId: number }) => {
        events.push(`resolve:${backendNodeId}`)
        return { object: { objectId: `node-${backendNodeId}` } }
      },
    },
    Runtime: {
      callFunctionOn: async ({ objectId }: { objectId?: string }) => {
        events.push(`bounds:${objectId}`)
        return {
          result: {
            value: options.rect ?? {
              x: 10.6,
              y: 20.5,
              width: 40.2,
              height: 15.4,
            },
          },
        }
      },
      evaluate: async ({ expression }: { expression: string }) => {
        expressions.push(expression)
        if (expression.trim().startsWith('({x: window.scrollX')) {
          events.push('scroll')
          return { result: { value: { x: 5, y: 100 } } }
        }
        if (expression.trim().startsWith('({x:0,y:0,width:')) {
          events.push('viewport')
          return {
            result: { value: { x: 0, y: 0, width: 800, height: 600 } },
          }
        }
        if (expression.includes('createElement')) {
          events.push('inject')
        } else if (expression.includes('querySelectorAll')) {
          events.push('remove')
        } else {
          events.push('evaluate')
        }
        return { result: { value: true } }
      },
      releaseObjectGroup: async () => {
        events.push('release')
      },
    },
    Page: {
      captureScreenshot: async (params: {
        captureBeyondViewport?: boolean
      }) => {
        events.push(`capture:${params.captureBeyondViewport}`)
        if (options.rejectCapture) throw new Error('capture failed')
        return { data: 'png-data' }
      },
    },
  }
  const observer = {
    snapshot: async () => {
      events.push('snapshot')
      return {
        text: '- button "Save" [ref=e1]',
        refs,
        url: 'https://example.com',
      }
    },
    resolveRef: async (ref: string) => {
      events.push(`ref:${ref}`)
      return { session: pageSession, backendNodeId: 101 }
    },
  }

  return { events, expressions, observer, pageSession }
}

describe('captureScreenshotWithAnnotations', () => {
  it('defaults through the annotation lifecycle and returns annotation metadata', async () => {
    const harness = createHarness()

    const result = await captureScreenshotWithAnnotations({
      pageSession: harness.pageSession as never,
      observer: harness.observer as never,
      options: { format: 'png', fullPage: false },
    })

    expect(harness.events).toEqual([
      'viewport',
      'snapshot',
      'ref:e1',
      'resolve:101',
      'bounds:node-101',
      'inject',
      'capture:false',
      'remove',
      'release',
    ])
    expect(harness.expressions[1]).toContain(
      'data-browseros-screenshot-annotation',
    )
    expect(harness.expressions[1]).not.toContain('getElementById')
    expect(harness.expressions[1]).toContain(
      'var useDocumentSpaceLabels = false;',
    )
    expect(harness.expressions[1]).toContain(
      'var labelAnchor = useDocumentSpaceLabels ? dy : it.y;',
    )
    expect(harness.expressions[1]).toContain('"number":1')
    expect(result).toEqual({
      data: 'png-data',
      mimeType: 'image/png',
      annotations: [
        {
          ref: 'e1',
          number: 1,
          role: 'button',
          name: 'Save',
          box: { x: 11, y: 21, width: 40, height: 15 },
        },
      ],
    })
  })

  it('captures without snapshot or overlay work when annotations are disabled', async () => {
    const harness = createHarness()
    harness.observer.snapshot = async () => {
      throw new Error('snapshot should not run')
    }

    const result = await captureScreenshotWithAnnotations({
      pageSession: harness.pageSession as never,
      observer: harness.observer as never,
      options: { format: 'png', fullPage: true, annotate: false },
    })

    expect(harness.events).toEqual(['capture:true'])
    expect(result).toEqual({
      data: 'png-data',
      mimeType: 'image/png',
      annotations: [],
    })
  })

  it('removes the injected overlay when screenshot capture fails', async () => {
    const harness = createHarness({ rejectCapture: true })

    await expect(
      captureScreenshotWithAnnotations({
        pageSession: harness.pageSession as never,
        observer: harness.observer as never,
        options: { format: 'png', fullPage: false, annotate: true },
      }),
    ).rejects.toThrow('capture failed')

    expect(harness.events).toEqual([
      'viewport',
      'snapshot',
      'ref:e1',
      'resolve:101',
      'bounds:node-101',
      'inject',
      'capture:false',
      'remove',
      'release',
    ])
  })

  it('projects full-page annotation metadata into document coordinates', async () => {
    const harness = createHarness()

    const result = await captureScreenshotWithAnnotations({
      pageSession: harness.pageSession as never,
      observer: harness.observer as never,
      options: { format: 'png', fullPage: true, annotate: true },
    })

    expect(harness.events).toEqual([
      'snapshot',
      'ref:e1',
      'resolve:101',
      'bounds:node-101',
      'inject',
      'capture:true',
      'scroll',
      'remove',
      'release',
    ])
    expect(result.annotations[0]?.box).toEqual({
      x: 16,
      y: 121,
      width: 40,
      height: 15,
    })
  })

  it('clips viewport annotations to the visible screenshot area', async () => {
    const harness = createHarness({
      rect: { x: -5, y: 10, width: 20, height: 20 },
    })

    const result = await captureScreenshotWithAnnotations({
      pageSession: harness.pageSession as never,
      observer: harness.observer as never,
      options: { format: 'png', fullPage: false },
    })

    expect(result.annotations[0]?.box).toEqual({
      x: 0,
      y: 10,
      width: 15,
      height: 20,
    })
  })
})

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
        }
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
        }
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
