import type { Browser } from '@browseros/server/browser'
import {
  LAYOUT_SETTLE_MS,
  VL_VIEWPORT_HEIGHT,
  VL_VIEWPORT_WIDTH,
} from '../constants'
import type {
  CollectionState,
  CollectionTarget,
  ElementRecord,
} from '../types/collection-target'
import { sleep } from '../utils/sleep'
import type { RecordWriter } from './record-writer'
import { parseSnapshot } from './snapshot-parser'

export interface VlCollectorDeps {
  browser: Browser
  pageId: number
  writer: RecordWriter
  log?: (msg: string) => void
}

export class VlCollector {
  constructor(private readonly deps: VlCollectorDeps) {}

  async collect(target: CollectionTarget): Promise<number> {
    const { browser, pageId, writer, log } = this.deps
    await browser.setViewport(pageId, VL_VIEWPORT_WIDTH, VL_VIEWPORT_HEIGHT, 1)
    await browser.goto(pageId, target.url)

    let written = 0
    for (const state of target.states) {
      try {
        await this.applyState(state)
        await sleep(LAYOUT_SETTLE_MS)
        const { record, pngBase64 } = await this.captureOne(target)
        const result = await writer.write(record, pngBase64)
        if (!result.skipped) {
          written++
          log?.(`  captured ${result.id} (${state.kind})`)
        } else {
          log?.(`  skipped existing ${result.id}`)
        }
      } catch (error) {
        log?.(`  failed ${target.site} ${state.kind}: ${errorMessage(error)}`)
      }
    }
    return written
  }

  private async applyState(state: CollectionState): Promise<void> {
    const { browser, pageId } = this.deps
    switch (state.kind) {
      case 'initial':
        return
      case 'scroll':
        await browser.evaluate(pageId, `window.scrollTo(0, ${state.pixels})`)
        return
      case 'click_and_wait': {
        const { x1, y1, x2, y2 } = await browser.getElementBbox(
          pageId,
          state.backend_id,
        )
        const cx = Math.floor((x1 + x2) / 2)
        const cy = Math.floor((y1 + y2) / 2)
        await browser.clickAt(pageId, cx, cy)
        await sleep(state.wait_ms)
        return
      }
      case 'evaluate':
        await browser.evaluate(pageId, state.expression)
        await sleep(state.wait_ms)
        return
    }
  }

  private async captureOne(target: CollectionTarget): Promise<{
    record: Omit<
      import('../types/collection-target').CollectedRecord,
      'id' | 'screenshot_path'
    >
    pngBase64: string
  }> {
    const { browser, pageId } = this.deps
    const rawSnapshot = await browser.snapshot(pageId)
    const snapshot = rawSnapshot.replace(/\n$/, '')
    const parsed = parseSnapshot(snapshot)

    const elements: ElementRecord[] = []
    for (const line of parsed) {
      let bbox: [number, number, number, number]
      try {
        const box = await browser.getElementBbox(pageId, line.backend_id)
        bbox = [box.x1, box.y1, box.x2, box.y2]
      } catch {
        bbox = [0, 0, 0, 0]
      }
      elements.push({
        backend_id: line.backend_id,
        role: line.role,
        name: line.name,
        bbox,
        snapshot_line: line.snapshot_line,
        in_viewport: overlapsViewport(bbox),
      })
    }

    const scrollY = toInt(
      (await browser.evaluate(pageId, 'window.scrollY')).value,
    )
    const resolvedUrl = coerceString(
      (await browser.evaluate(pageId, 'window.location.href')).value,
      target.url,
    )
    const screenshot = await browser.screenshot(pageId, {
      format: 'png',
      fullPage: false,
    })

    return {
      record: {
        url: resolvedUrl,
        site: target.site,
        viewport: { width: VL_VIEWPORT_WIDTH, height: VL_VIEWPORT_HEIGHT },
        scroll_y: scrollY,
        snapshot,
        elements,
      },
      pngBase64: screenshot.data,
    }
  }
}

function overlapsViewport(bbox: [number, number, number, number]): boolean {
  const [x1, y1, x2, y2] = bbox
  if (x1 === 0 && y1 === 0 && x2 === 0 && y2 === 0) return false
  return x1 < VL_VIEWPORT_WIDTH && x2 > 0 && y1 < VL_VIEWPORT_HEIGHT && y2 > 0
}

function toInt(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0
}

function coerceString(v: unknown, fallback: string): string {
  return typeof v === 'string' && v.length > 0 ? v : fallback
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}
