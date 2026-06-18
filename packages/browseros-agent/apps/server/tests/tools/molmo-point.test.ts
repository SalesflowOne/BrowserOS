/**
 * @license
 * Copyright 2025 BrowserOS
 */

import { afterEach, describe, expect, it } from 'bun:test'
import { Buffer } from 'node:buffer'

import type { Browser } from '../../src/browser/browser'
import { requestMolmoPoint, resolvePoint } from '../../src/tools/molmo-point'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

function mockFetch(handler: (url: string, init?: RequestInit) => Response) {
  globalThis.fetch = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => handler(String(input), init)) as typeof fetch
}

/** Minimal base64 PNG carrying the given IHDR width/height (header only). */
function pngB64(width: number, height: number): string {
  const buf = Buffer.alloc(24)
  Buffer.from('89504e470d0a1a0a', 'hex').copy(buf, 0)
  buf.writeUInt32BE(width, 16)
  buf.writeUInt32BE(height, 20)
  return buf.toString('base64')
}

function fakeBrowser(opts: {
  viewport: { width: number; height: number }
  pngWidth: number
  pngHeight: number
  devicePixelRatio?: number
}): Browser {
  return {
    screenshot: async () => ({
      data: pngB64(opts.pngWidth, opts.pngHeight),
      mimeType: 'image/png',
      devicePixelRatio: opts.devicePixelRatio ?? 2,
    }),
    evaluate: async (_page: number, expr: string) => ({
      value: expr.includes('innerWidth')
        ? opts.viewport.width
        : opts.viewport.height,
    }),
  } as unknown as Browser
}

describe('requestMolmoPoint', () => {
  it('posts the predict payload and returns the point + image size', async () => {
    let capturedUrl = ''
    let capturedBody: Record<string, unknown> = {}
    mockFetch((url, init) => {
      capturedUrl = url
      capturedBody = JSON.parse(String(init?.body))
      return new Response(
        JSON.stringify({
          point: { x: 12, y: 34 },
          points: [{ x: 12, y: 34 }],
          image_size: { width: 1709, height: 1417 },
        }),
        { status: 200 },
      )
    })

    const result = await requestMolmoPoint({
      endpoint: 'https://browseros--predict.modal.run',
      prompt: 'the search box',
      imageB64: 'IMG',
    })

    expect(result.point).toEqual({ x: 12, y: 34 })
    expect(result.imageSize).toEqual({ width: 1709, height: 1417 })
    // Posts to the endpoint URL directly (no /point suffix).
    expect(capturedUrl).toBe('https://browseros--predict.modal.run')
    expect(capturedBody).toMatchObject({
      prompt: 'the search box',
      image_base64: 'IMG',
      style: 'pointing',
    })
  })

  it('falls back to points[0] when point is absent', async () => {
    mockFetch(
      () =>
        new Response(JSON.stringify({ points: [{ x: 5, y: 6 }] }), {
          status: 200,
        }),
    )
    const result = await requestMolmoPoint({
      endpoint: 'https://molmo.example.com',
      prompt: 'x',
      imageB64: 'IMG',
    })
    expect(result.point).toEqual({ x: 5, y: 6 })
    expect(result.imageSize).toBeNull()
  })

  it('throws on a non-OK response', async () => {
    mockFetch(() => new Response('boom', { status: 500 }))
    await expect(
      requestMolmoPoint({
        endpoint: 'https://molmo.example.com',
        prompt: 'x',
        imageB64: 'IMG',
      }),
    ).rejects.toThrow('Molmo point request failed (500)')
  })

  it('throws when no valid point is present', async () => {
    mockFetch(
      () => new Response(JSON.stringify({ points: [] }), { status: 200 }),
    )
    await expect(
      requestMolmoPoint({
        endpoint: 'https://molmo.example.com',
        prompt: 'x',
        imageB64: 'IMG',
      }),
    ).rejects.toThrow('did not include a valid point')
  })
})

describe('resolvePoint', () => {
  it('scales the model pixel point to CSS px using the response image size', async () => {
    // Model image 2400x1600, CSS viewport 1200x800 -> scale 2. Point
    // (2112, 200) in image px should become (1056, 100) in CSS px.
    mockFetch(
      () =>
        new Response(
          JSON.stringify({
            point: { x: 2112, y: 200 },
            image_size: { width: 2400, height: 1600 },
          }),
          { status: 200 },
        ),
    )

    const point = await resolvePoint(
      fakeBrowser({
        viewport: { width: 1200, height: 800 },
        pngWidth: 999, // ignored: response image_size wins
        pngHeight: 999,
      }),
      1,
      'the Pickup & Delivery button',
      'https://molmo.example.com',
    )

    expect(point).toEqual({ x: 1056, y: 100 })
  })

  it('falls back to devicePixelRatio when viewport size is unavailable', async () => {
    mockFetch(
      () =>
        new Response(JSON.stringify({ points: [{ x: 400, y: 200 }] }), {
          status: 200,
        }),
    )

    const point = await resolvePoint(
      fakeBrowser({
        viewport: { width: 0, height: 0 },
        pngWidth: 2400,
        pngHeight: 1600,
        devicePixelRatio: 2,
      }),
      1,
      'target',
      'https://molmo.example.com/',
    )

    expect(point).toEqual({ x: 200, y: 100 })
  })
})

describe('getPngDimensionsFromBase64', () => {
  it('reads width/height from a PNG header', async () => {
    const { getPngDimensionsFromBase64 } = await import(
      '../../src/tools/molmo-point'
    )
    expect(getPngDimensionsFromBase64(pngB64(2400, 1606))).toEqual({
      width: 2400,
      height: 1606,
    })
    expect(getPngDimensionsFromBase64('not-a-png')).toBeNull()
  })
})
