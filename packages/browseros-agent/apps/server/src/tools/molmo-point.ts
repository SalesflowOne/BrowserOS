import { Buffer } from 'node:buffer'
import type { Browser } from '../browser/browser'
import { logger } from '../lib/logger'

const MAX_NEW_TOKENS = 128
// Generous to absorb a Modal cold start on the first call; warm calls are ~1s.
const REQUEST_TIMEOUT_MS = 300_000
const ERROR_BODY_MAX_CHARS = 500
const PNG_SIGNATURE = '89504e470d0a1a0a'

export interface ClickPoint {
  x: number
  y: number
}

export interface ImageSize {
  width: number
  height: number
}

export interface MolmoPointResult {
  point: ClickPoint
  /** Pixel size of the image the model scored its point against. */
  imageSize: ImageSize | null
}

/** Read width/height from a base64-encoded PNG's IHDR chunk. */
export function getPngDimensionsFromBase64(imageB64: string): ImageSize | null {
  const buffer = Buffer.from(imageB64, 'base64')
  if (buffer.length < 24) return null
  if (buffer.subarray(0, 8).toString('hex') !== PNG_SIGNATURE) return null
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
}

interface PredictResponse {
  point?: unknown
  points?: unknown
  image_size?: unknown
}

function asPoint(value: unknown): ClickPoint | null {
  const point = value as { x?: unknown; y?: unknown }
  if (typeof point?.x !== 'number' || typeof point?.y !== 'number') return null
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return null
  return { x: point.x, y: point.y }
}

function firstValidPoint(points: unknown): ClickPoint | null {
  if (!Array.isArray(points)) return null
  for (const raw of points) {
    const point = asPoint(raw)
    if (point) return point
  }
  return null
}

function asImageSize(value: unknown): ImageSize | null {
  const size = value as { width?: unknown; height?: unknown }
  if (typeof size?.width !== 'number' || typeof size?.height !== 'number') {
    return null
  }
  if (size.width <= 0 || size.height <= 0) return null
  return { width: size.width, height: size.height }
}

/**
 * Ask the MolmoPoint model where to act. Returns the model's point in the
 * input image's PIXEL space plus the image size it scored against; callers
 * rescale to CSS coordinates.
 *
 * `endpoint` is the predict URL itself (e.g. https://browseros--predict.modal.run).
 */
export async function requestMolmoPoint(args: {
  endpoint: string
  prompt: string
  imageB64: string
}): Promise<MolmoPointResult> {
  const response = await fetch(args.endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      prompt: args.prompt,
      image_base64: args.imageB64,
      style: 'pointing',
      max_new_tokens: MAX_NEW_TOKENS,
      temperature: 0,
      decode_points: true,
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    logger.warn('Molmo point request failed', {
      endpoint: args.endpoint,
      status: response.status,
      statusText: response.statusText,
    })
    const suffix = body ? `: ${body.slice(0, ERROR_BODY_MAX_CHARS)}` : ''
    throw new Error(`Molmo point request failed (${response.status})${suffix}`)
  }

  const payload = (await response.json()) as PredictResponse
  const point = asPoint(payload.point) ?? firstValidPoint(payload.points)
  if (!point) {
    throw new Error('Molmo point response did not include a valid point')
  }
  return { point, imageSize: asImageSize(payload.image_size) }
}

/**
 * Resolve a natural-language target into CSS click coordinates on the page.
 *
 * MolmoPoint returns its point in the input image's PIXEL space. The screenshot
 * is captured at the page's device scale, so we convert to the CSS pixels
 * clickAt/hoverAt/typeAt expect by dividing by the image-to-viewport scale
 * (imageWidth / innerWidth). The image size comes from the model response
 * (authoritative), falling back to the PNG header, then devicePixelRatio.
 */
export async function resolvePoint(
  browser: Browser,
  page: number,
  prompt: string,
  endpoint: string,
): Promise<ClickPoint> {
  const shot = await browser.screenshot(page, {
    format: 'png',
    fullPage: false,
  })
  const { point, imageSize } = await requestMolmoPoint({
    endpoint,
    prompt,
    imageB64: shot.data,
  })

  const dims = imageSize ?? getPngDimensionsFromBase64(shot.data)
  const dpr = shot.devicePixelRatio || 1
  const [vw, vh] = await Promise.all([
    browser.evaluate(page, 'window.innerWidth').catch(() => ({ value: 0 })),
    browser.evaluate(page, 'window.innerHeight').catch(() => ({ value: 0 })),
  ])
  const width = Number(vw.value) || 0
  const height = Number(vh.value) || 0
  const scaleX = dims && width ? dims.width / width : dpr
  const scaleY = dims && height ? dims.height / height : dpr
  return { x: point.x / scaleX, y: point.y / scaleY }
}
