import type { ProtocolApi } from '@browseros/cdp-protocol/protocol-api'
import type { Observer } from './observer/observer'
import type { RefEntry } from './snapshot/refs'

const ANNOTATION_OVERLAY_ID = '__browseros_screenshot_annotations__'

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
  let annotations: RawAnnotation[] = []
  let overlayInjected = false

  try {
    if (options.annotate) {
      annotations = await collectAnnotations(pageSession, observer)
      if (annotations.length > 0) {
        await injectAnnotationOverlay(pageSession, annotations)
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
      await removeAnnotationOverlay(pageSession).catch(() => {})
    }
  }
}

async function collectAnnotations(
  pageSession: ProtocolApi,
  observer: Observer,
): Promise<RawAnnotation[]> {
  const snapshot = await observer.snapshot()
  const entries = [...snapshot.refs.byRef.values()].sort(
    (left, right) => annotationNumber(left.ref) - annotationNumber(right.ref),
  )
  const annotations = await Promise.all(
    entries.map((entry) => collectAnnotation(pageSession, observer, entry)),
  )
  return annotations.filter((item): item is RawAnnotation => item !== undefined)
}

async function collectAnnotation(
  pageSession: ProtocolApi,
  observer: Observer,
  entry: RefEntry,
): Promise<RawAnnotation | undefined> {
  try {
    const resolved = await observer.resolveRef(entry.ref)
    const localRect = await readElementRect(
      resolved.session,
      resolved.backendNodeId,
    )
    if (!localRect) return undefined

    const rect =
      entry.frameId === undefined
        ? localRect
        : await projectFrameRect(pageSession, entry.frameId, localRect)
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
  frameId: string,
  rect: Rect,
): Promise<Rect | undefined> {
  try {
    const owner = await pageSession.DOM.getFrameOwner({ frameId })
    const offset = await readFrameContentOffset(
      pageSession,
      owner.backendNodeId,
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
): Promise<Rect | undefined> {
  const objectId = await resolveObjectId(session, backendNodeId)
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
): Promise<{ x: number; y: number } | undefined> {
  const objectId = await resolveObjectId(session, backendNodeId)
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
): Promise<string | undefined> {
  try {
    const resolved = await session.DOM.resolveNode({
      backendNodeId,
      objectGroup: 'browseros-screenshot-annotations',
    })
    return resolved.object?.objectId
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

async function injectAnnotationOverlay(
  session: ProtocolApi,
  annotations: RawAnnotation[],
): Promise<void> {
  const items = JSON.stringify(
    annotations.map((annotation) => ({
      number: annotation.number,
      x: round(annotation.rect.x),
      y: round(annotation.rect.y),
      width: round(annotation.rect.width),
      height: round(annotation.rect.height),
    })),
  )
  const overlayId = JSON.stringify(ANNOTATION_OVERLAY_ID)

  await session.Runtime.evaluate({
    expression: `(() => {
      var items = ${items};
      var id = ${overlayId};
      var existing = document.getElementById(id);
      if (existing) existing.remove();
      var sx = window.scrollX || 0;
      var sy = window.scrollY || 0;
      var c = document.createElement('div');
      c.id = id;
      c.style.cssText = 'position:absolute;top:0;left:0;width:0;height:0;pointer-events:none;z-index:2147483647;';
      for (var i = 0; i < items.length; i++) {
        var it = items[i];
        var dx = it.x + sx;
        var dy = it.y + sy;
        var b = document.createElement('div');
        b.style.cssText = 'position:absolute;left:' + dx + 'px;top:' + dy + 'px;width:' + it.width + 'px;height:' + it.height + 'px;border:2px solid rgba(255,0,0,0.8);box-sizing:border-box;pointer-events:none;';
        var l = document.createElement('div');
        l.textContent = String(it.number);
        var labelTop = dy < 14 ? '2px' : '-14px';
        l.style.cssText = 'position:absolute;top:' + labelTop + ';left:-2px;background:rgba(255,0,0,0.9);color:#fff;font:bold 11px/14px monospace;padding:0 4px;border-radius:2px;white-space:nowrap;';
        b.appendChild(l);
        c.appendChild(b);
      }
      document.documentElement.appendChild(c);
      return true;
    })()`,
    returnByValue: true,
    awaitPromise: false,
  })
}

async function removeAnnotationOverlay(session: ProtocolApi): Promise<void> {
  const overlayId = JSON.stringify(ANNOTATION_OVERLAY_ID)
  await session.Runtime.evaluate({
    expression: `(() => {
      var el = document.getElementById(${overlayId});
      if (el) el.remove();
      return true;
    })()`,
    returnByValue: true,
    awaitPromise: false,
  })
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
