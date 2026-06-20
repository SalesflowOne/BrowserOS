import type { ProtocolApi } from '@browseros/cdp-protocol/protocol-api'
import type { Observer } from './observer/observer'
import { frameDepth } from './screenshot-frame'
import {
  createOverlayToken,
  injectAnnotationOverlay,
  removeAnnotationOverlay,
} from './screenshot-overlay'
import type { RefEntry } from './snapshot/refs'

const OBJECT_GROUP = 'browseros-screenshot-annotations'

export type ScreenshotFormat = 'png' | 'jpeg' | 'webp'

export interface ScreenshotCaptureOptions {
  format?: ScreenshotFormat
  quality?: number
  fullPage?: boolean
  annotate?: boolean
}

export interface ScreenshotAnnotationBox {
  x: number
  y: number
  width: number
  height: number
}

export interface ScreenshotAnnotation {
  ref: string
  number: number
  role: string
  name?: string
  box: ScreenshotAnnotationBox
}

export interface ScreenshotCaptureResult {
  data: string
  mimeType: string
  annotations: ScreenshotAnnotation[]
}

interface CaptureInput {
  pageSession: ProtocolApi
  observer: Observer
  options: ScreenshotCaptureOptions
}

interface Rect {
  x: number
  y: number
  width: number
  height: number
}

interface RawAnnotation {
  ref: string
  number: number
  role: string
  name?: string
  rect: Rect
}

/** Captures a screenshot, optionally painting current snapshot refs into a temporary page overlay. */
export async function captureScreenshotWithAnnotations({
  pageSession,
  observer,
  options,
}: CaptureInput): Promise<ScreenshotCaptureResult> {
  const format = options.format ?? 'png'
  const fullPage = options.fullPage ?? false
  const annotate = options.annotate ?? true
  let annotations: RawAnnotation[] = []
  let overlayInjected = false
  const overlayToken = createOverlayToken()
  const objectSessions = new Set<ProtocolApi>()

  try {
    if (annotate) {
      const captureArea = fullPage
        ? undefined
        : await readViewportRect(pageSession).catch(() => undefined)
      annotations = clipAnnotations(
        await collectAnnotations(pageSession, observer, objectSessions),
        captureArea,
      )
      if (annotations.length > 0) {
        await injectAnnotationOverlay(
          pageSession,
          overlayToken,
          fullPage,
          annotations,
        )
        overlayInjected = true
      }
    }

    const result = await pageSession.Page.captureScreenshot({
      format,
      ...(format !== 'png' &&
        options.quality !== undefined && { quality: options.quality }),
      captureBeyondViewport: fullPage,
    })
    const scroll =
      fullPage && annotations.length > 0
        ? await readScrollOffsets(pageSession).catch(() => undefined)
        : undefined

    return {
      data: result.data,
      mimeType: `image/${format}`,
      annotations: projectAnnotations(annotations, scroll),
    }
  } finally {
    if (overlayInjected) {
      await removeAnnotationOverlay(pageSession, overlayToken).catch(() => {})
    }
    await releaseObjectGroup(objectSessions)
  }
}

async function collectAnnotations(
  pageSession: ProtocolApi,
  observer: Observer,
  objectSessions: Set<ProtocolApi>,
): Promise<RawAnnotation[]> {
  const snapshot = await observer.snapshot()
  const entries = [...snapshot.refs.byRef.values()].sort(
    (left, right) => annotationNumber(left.ref) - annotationNumber(right.ref),
  )
  const annotations = await Promise.all(
    entries.map((entry) =>
      collectAnnotation(pageSession, observer, objectSessions, entry),
    ),
  )
  return annotations.filter((item): item is RawAnnotation => item !== undefined)
}

async function collectAnnotation(
  pageSession: ProtocolApi,
  observer: Observer,
  objectSessions: Set<ProtocolApi>,
  entry: RefEntry,
): Promise<RawAnnotation | undefined> {
  try {
    const resolved = await observer.resolveRef(entry.ref)
    const localRect = await readElementRect(
      resolved.session,
      resolved.backendNodeId,
      objectSessions,
    )
    if (!localRect) return undefined

    const rect =
      entry.frameId === undefined
        ? localRect
        : await projectFrameRect(
            pageSession,
            objectSessions,
            entry.frameId,
            localRect,
          )
    if (!rect) return undefined

    return {
      ref: entry.ref,
      number: annotationNumber(entry.ref),
      role: entry.role,
      ...(entry.name && { name: entry.name }),
      rect,
    }
  } catch {
    return undefined
  }
}

async function projectFrameRect(
  pageSession: ProtocolApi,
  objectSessions: Set<ProtocolApi>,
  frameId: string,
  rect: Rect,
): Promise<Rect | undefined> {
  try {
    if ((await frameDepth(pageSession, frameId)) !== 1) return undefined
    const owner = await pageSession.DOM.getFrameOwner({ frameId })
    const offset = await readFrameContentOffset(
      pageSession,
      owner.backendNodeId,
      objectSessions,
    )
    if (!offset) return undefined
    return {
      x: offset.x + rect.x,
      y: offset.y + rect.y,
      width: rect.width,
      height: rect.height,
    }
  } catch {
    return undefined
  }
}

async function readElementRect(
  session: ProtocolApi,
  backendNodeId: number,
  objectSessions: Set<ProtocolApi>,
): Promise<Rect | undefined> {
  const objectId = await resolveObjectId(session, backendNodeId, objectSessions)
  if (!objectId) return undefined

  const result = await session.Runtime.callFunctionOn({
    functionDeclaration:
      'function(){var r=this.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height}}',
    objectId,
    returnByValue: true,
  })
  const rect = parseRect(result.result?.value)
  if (!rect || rect.width <= 0 || rect.height <= 0) return undefined
  return rect
}

async function readFrameContentOffset(
  session: ProtocolApi,
  backendNodeId: number,
  objectSessions: Set<ProtocolApi>,
): Promise<{ x: number; y: number } | undefined> {
  const objectId = await resolveObjectId(session, backendNodeId, objectSessions)
  if (!objectId) return undefined

  const result = await session.Runtime.callFunctionOn({
    functionDeclaration:
      'function(){var r=this.getBoundingClientRect();return{x:r.x+(this.clientLeft||0),y:r.y+(this.clientTop||0)}}',
    objectId,
    returnByValue: true,
  })
  const value = result.result?.value
  if (!isRecord(value)) return undefined
  const x = value.x
  const y = value.y
  if (typeof x !== 'number' || typeof y !== 'number') return undefined
  if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined
  return { x, y }
}

async function resolveObjectId(
  session: ProtocolApi,
  backendNodeId: number,
  objectSessions: Set<ProtocolApi>,
): Promise<string | undefined> {
  try {
    const resolved = await session.DOM.resolveNode({
      backendNodeId,
      objectGroup: OBJECT_GROUP,
    })
    const objectId = resolved.object?.objectId
    if (objectId) objectSessions.add(session)
    return objectId
  } catch {
    return undefined
  }
}

function parseRect(value: unknown): Rect | undefined {
  if (!isRecord(value)) return undefined
  const { x, y, width, height } = value
  if (
    typeof x !== 'number' ||
    typeof y !== 'number' ||
    typeof width !== 'number' ||
    typeof height !== 'number'
  ) {
    return undefined
  }
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(width) ||
    !Number.isFinite(height)
  ) {
    return undefined
  }
  return { x, y, width, height }
}

async function readViewportRect(session: ProtocolApi): Promise<Rect> {
  const result = await session.Runtime.evaluate({
    expression:
      '({x:0,y:0,width:window.innerWidth||0,height:window.innerHeight||0})',
    returnByValue: true,
    awaitPromise: false,
  })
  return (
    parseRect(result.result?.value) ?? {
      x: 0,
      y: 0,
      width: 0,
      height: 0,
    }
  )
}

async function readScrollOffsets(
  session: ProtocolApi,
): Promise<{ x: number; y: number }> {
  const result = await session.Runtime.evaluate({
    expression: '({x: window.scrollX || 0, y: window.scrollY || 0})',
    returnByValue: true,
    awaitPromise: false,
  })
  const value = result.result?.value
  if (!isRecord(value)) return { x: 0, y: 0 }
  const x =
    typeof value.x === 'number' && Number.isFinite(value.x) ? value.x : 0
  const y =
    typeof value.y === 'number' && Number.isFinite(value.y) ? value.y : 0
  return { x, y }
}

function projectAnnotations(
  annotations: RawAnnotation[],
  scroll?: { x: number; y: number },
): ScreenshotAnnotation[] {
  return annotations.map((annotation) => ({
    ref: annotation.ref,
    number: annotation.number,
    role: annotation.role,
    ...(annotation.name && { name: annotation.name }),
    box: {
      x: round(annotation.rect.x + (scroll?.x ?? 0)),
      y: round(annotation.rect.y + (scroll?.y ?? 0)),
      width: round(annotation.rect.width),
      height: round(annotation.rect.height),
    },
  }))
}

function clipAnnotations(
  annotations: RawAnnotation[],
  captureArea: Rect | undefined,
): RawAnnotation[] {
  if (!captureArea || captureArea.width <= 0 || captureArea.height <= 0) {
    return annotations
  }
  return annotations.flatMap((annotation) => {
    const rect = intersectRects(annotation.rect, captureArea)
    return rect ? [{ ...annotation, rect }] : []
  })
}

function intersectRects(left: Rect, right: Rect): Rect | undefined {
  const x1 = Math.max(left.x, right.x)
  const y1 = Math.max(left.y, right.y)
  const x2 = Math.min(left.x + left.width, right.x + right.width)
  const y2 = Math.min(left.y + left.height, right.y + right.height)
  if (x2 <= x1 || y2 <= y1) return undefined
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 }
}

async function releaseObjectGroup(sessions: Set<ProtocolApi>): Promise<void> {
  await Promise.all(
    [...sessions].map((session) =>
      session.Runtime.releaseObjectGroup({ objectGroup: OBJECT_GROUP }).catch(
        () => {},
      ),
    ),
  )
}

function annotationNumber(ref: string): number {
  const number = Number.parseInt(ref.replace(/^e/, ''), 10)
  return Number.isFinite(number) ? number : 0
}

function round(value: number): number {
  return Math.round(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
