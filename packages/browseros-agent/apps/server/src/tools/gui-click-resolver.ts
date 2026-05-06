import type { ToolContext } from './framework'
import {
  getPngDimensionsFromBase64,
  requestMolmoPoint,
} from './molmo-point-client'

const LOG_TEXT_MAX_CHARS = 500

function truncateForLog(value: string | undefined): string | undefined {
  if (!value) return value
  if (value.length <= LOG_TEXT_MAX_CHARS) return value
  return `${value.slice(0, LOG_TEXT_MAX_CHARS)}... (+${value.length - LOG_TEXT_MAX_CHARS} chars)`
}

export interface GuiPointResult {
  x: number
  y: number
  hitElement: GuiHitElement | null
  log: Record<string, unknown>
}

export interface GuiHitElement {
  tagName: string
  role?: string
  ariaLabel?: string
  labelText?: string
  textContent?: string
}

function summarizeHitElement(
  hitElement: Awaited<
    ReturnType<ToolContext['browser']['resolveElementProperties']>
  >,
): GuiHitElement | null {
  if (!hitElement) return null

  return {
    tagName: hitElement.tagName,
    role: hitElement.role,
    ariaLabel: truncateForLog(hitElement.ariaLabel),
    labelText: truncateForLog(hitElement.labelText),
    textContent: truncateForLog(hitElement.textContent),
  }
}

export async function resolveGuiPoint(
  ctx: ToolContext,
  page: number,
  prompt: string,
): Promise<GuiPointResult> {
  const screenshot = await ctx.browser.screenshot(page, {
    format: 'png',
    fullPage: false,
  })
  const point = await requestMolmoPoint({
    instruction: prompt,
    imageB64: screenshot.data,
  })

  const dimensions = getPngDimensionsFromBase64(screenshot.data)
  const viewport = await ctx.browser.viewportSize(page).catch(() => null)
  const scaleX =
    dimensions && viewport?.width
      ? dimensions.width / viewport.width
      : screenshot.devicePixelRatio
  const scaleY =
    dimensions && viewport?.height
      ? dimensions.height / viewport.height
      : screenshot.devicePixelRatio
  const x = point.x / (scaleX || 1)
  const y = point.y / (scaleY || 1)
  const pageInfo = await ctx.browser.refreshPageInfo(page).catch(() => null)
  const hitElementId = await ctx.browser
    .resolveElementAtPoint(page, x, y)
    .catch(() => null)
  const hitElement =
    hitElementId !== null
      ? await ctx.browser
          .resolveElementProperties(page, hitElementId)
          .catch(() => null)
      : null
  const hitElementSummary = summarizeHitElement(hitElement)

  return {
    x,
    y,
    hitElement: hitElementSummary,
    log: {
      page,
      pageUrl: truncateForLog(pageInfo?.url),
      pageTitle: truncateForLog(pageInfo?.title),
      prompt: truncateForLog(prompt),
      promptLength: prompt.length,
      promptTruncated: prompt.length > LOG_TEXT_MAX_CHARS,
      modelPoint: point,
      resolvedPoint: { x, y },
      scale: { x: scaleX, y: scaleY },
      screenshot: {
        width: dimensions?.width,
        height: dimensions?.height,
        devicePixelRatio: screenshot.devicePixelRatio,
      },
      viewport,
      hitElementId,
      hitElement: hitElementSummary,
    },
  }
}
