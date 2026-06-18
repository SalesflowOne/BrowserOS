import type { LanguageModelV2ToolResultOutput } from '@ai-sdk/provider'
import { type ToolSet, tool } from 'ai'
import { z } from 'zod'
import type { Browser } from '../browser/browser'
import type { BrowserSession } from '../browser/core/session'
import { logger } from '../lib/logger'
import { metrics } from '../lib/metrics'
import {
  type ToolDefinition as BrowserToolDefinition,
  type ToolResult as BrowserToolResult,
  type ContentBlock,
  errorResult,
  executeTool as executeBrowserTool,
  throwIfAborted,
} from '../tools/browser/framework'
import { BROWSER_TOOLS } from '../tools/browser/registry'
import {
  executeTool as executeLegacyTool,
  type ToolContext as LegacyToolContext,
} from '../tools/legacy/framework'
import { registry as LEGACY_BROWSER_TOOLS } from '../tools/legacy/registry'
import { resolvePoint } from '../tools/molmo-point'

export interface BrowserToolSetOptions {
  readOnly?: boolean
}

export interface LegacyBrowserToolSetOptions {
  workingDir?: string
  origin?: 'sidepanel' | 'newtab'
  originPageId?: number
  /**
   * When set, the legacy surface runs in GUI (vision) mode: element-ID and
   * DOM-tree tools are removed and replaced with MolmoPoint-backed pointing
   * tools (click/hover/type) that resolve a visual prompt to coordinates.
   */
  gui?: { molmoEndpoint: string }
}

/**
 * Legacy tools removed in GUI mode: everything that operates on snapshot
 * element IDs or the DOM tree. Perception is vision-only (take_screenshot)
 * plus readable text (get_page_content/get_page_links).
 */
const GUI_EXCLUDED_LEGACY_TOOLS = new Set([
  'take_snapshot',
  'get_dom',
  'search_dom',
  'click',
  'hover',
  'fill',
  'focus',
  'clear',
  'check',
  'uncheck',
  'select_option',
  'drag',
  'download_file',
  'upload_file',
])

interface ToolExecuteOptions {
  abortSignal?: AbortSignal
}

const BROWSER_TOOL_TIMEOUT_MS = 120_000

function withBrowserToolTimeout(signal?: AbortSignal): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(BROWSER_TOOL_TIMEOUT_MS)
  if (!signal) return timeoutSignal

  const controller = new AbortController()
  const forwardAbort = (source: AbortSignal) => {
    if (source.aborted) {
      controller.abort(source.reason)
      return
    }
    source.addEventListener('abort', () => controller.abort(source.reason), {
      once: true,
    })
  }

  forwardAbort(signal)
  forwardAbort(timeoutSignal)
  return controller.signal
}

function contentToModelOutput(
  content: ContentBlock[],
): LanguageModelV2ToolResultOutput {
  const hasImages = content.some((c) => c.type === 'image')
  if (!hasImages) {
    const text = content
      .filter((c): c is ContentBlock & { type: 'text' } => c.type === 'text')
      .map((c) => c.text)
      .join('\n')
    return { type: 'text', value: text || 'Success' }
  }
  return {
    type: 'content',
    value: content.map((c) =>
      c.type === 'text'
        ? { type: 'text' as const, text: c.text }
        : { type: 'media' as const, data: c.data, mediaType: c.mimeType },
    ),
  }
}

/** Wraps the browser-core tool surface as AI SDK tools for the internal agent. */
export function buildBrowserToolSet(
  session: BrowserSession,
  options: BrowserToolSetOptions = {},
): ToolSet {
  const toolSet: ToolSet = {}

  for (const def of BROWSER_TOOLS) {
    toolSet[def.name] = tool({
      description: def.description,
      inputSchema: def.input,
      execute: async (params, executeOptions?: ToolExecuteOptions) => {
        const startTime = performance.now()
        const signal = withBrowserToolTimeout(executeOptions?.abortSignal)
        throwIfAborted(signal)
        const result =
          readOnlyGuard(def, params, options) ??
          (await executeBrowserTool(def, params as Record<string, unknown>, {
            session,
            signal,
          }))
        metrics.log('tool_executed', {
          tool_name: def.name,
          duration_ms: Math.round(performance.now() - startTime),
          success: !result.isError,
          source: 'chat',
        })
        return { content: result.content, isError: result.isError ?? false }
      },
      toModelOutput: ({ output }) => {
        const result = output as { content: ContentBlock[]; isError: boolean }
        if (result.isError) {
          const text = result.content
            .filter(
              (c): c is ContentBlock & { type: 'text' } => c.type === 'text',
            )
            .map((c) => c.text)
            .join('\n')
          return { type: 'error-text', value: text }
        }
        if (!result.content?.length) {
          return { type: 'text', value: 'Success' }
        }
        return contentToModelOutput(result.content)
      },
    })
  }

  return toolSet
}

/** Wraps the legacy browser tool surface as AI SDK tools for the internal agent. */
export function buildLegacyBrowserToolSet(
  browser: Browser,
  options: LegacyBrowserToolSetOptions = {},
): ToolSet {
  const toolSet: ToolSet = {}
  const context: LegacyToolContext = {
    browser,
    directories: { workingDir: options.workingDir },
    session: {
      origin: options.origin,
      originPageId: options.originPageId,
    },
  }

  for (const def of LEGACY_BROWSER_TOOLS.all()) {
    if (options.gui && GUI_EXCLUDED_LEGACY_TOOLS.has(def.name)) continue
    toolSet[def.name] = tool({
      description: def.description,
      inputSchema: def.input,
      execute: async (params, executeOptions?: ToolExecuteOptions) => {
        const startTime = performance.now()
        const signal = withBrowserToolTimeout(executeOptions?.abortSignal)
        try {
          const result = await executeLegacyTool(def, params, context, signal)
          metrics.log('tool_executed', {
            tool_name: def.name,
            duration_ms: Math.round(performance.now() - startTime),
            success: !result.isError,
            source: 'chat',
          })
          return {
            content: result.content,
            isError: result.isError ?? false,
            metadata: result.metadata,
          }
        } catch (error) {
          const errorText =
            error instanceof Error ? error.message : String(error)
          logger.error('Tool execution failed', {
            tool: def.name,
            error: errorText,
          })
          metrics.log('tool_executed', {
            tool_name: def.name,
            duration_ms: Math.round(performance.now() - startTime),
            success: false,
            error_message: errorText,
            source: 'chat',
          })
          return {
            content: [{ type: 'text' as const, text: errorText }],
            isError: true,
          }
        }
      },
      toModelOutput: ({ output }) => {
        const result = output as { content: ContentBlock[]; isError: boolean }
        if (result.isError) {
          const text = result.content
            .filter(
              (c): c is ContentBlock & { type: 'text' } => c.type === 'text',
            )
            .map((c) => c.text)
            .join('\n')
          return { type: 'error-text', value: text }
        }
        if (!result.content?.length) {
          return { type: 'text', value: 'Success' }
        }
        return contentToModelOutput(result.content)
      },
    })
  }

  if (options.gui) {
    Object.assign(
      toolSet,
      buildGuiPointingTools(browser, options.gui.molmoEndpoint),
    )
  }

  return toolSet
}

/**
 * MolmoPoint-backed pointing tools for GUI mode. Each resolves a visual
 * prompt to CSS coordinates, then drives the existing coordinate input
 * methods (clickAt/hoverAt/typeAt) on the browser facade.
 */
function buildGuiPointingTools(
  browser: Browser,
  molmoEndpoint: string,
): ToolSet {
  const pageParam = z.number().describe('Page ID (from list_pages)')
  const promptParam = z
    .string()
    .min(1)
    .describe('Visual description of the target, e.g. "the search box"')

  const runPointingTool = async (
    name: string,
    action: (point: { x: number; y: number }) => Promise<void>,
    describe: (point: { x: number; y: number }) => string,
    prompt: string,
    page: number,
  ): Promise<{ content: ContentBlock[]; isError: boolean }> => {
    const startTime = performance.now()
    try {
      const point = await resolvePoint(browser, page, prompt, molmoEndpoint)
      await action(point)
      metrics.log('tool_executed', {
        tool_name: name,
        duration_ms: Math.round(performance.now() - startTime),
        success: true,
        source: 'chat',
      })
      return {
        content: [{ type: 'text', text: describe(point) }],
        isError: false,
      }
    } catch (error) {
      const errorText = error instanceof Error ? error.message : String(error)
      logger.error('GUI pointing tool failed', { tool: name, error: errorText })
      metrics.log('tool_executed', {
        tool_name: name,
        duration_ms: Math.round(performance.now() - startTime),
        success: false,
        error_message: errorText,
        source: 'chat',
      })
      return { content: [{ type: 'text', text: errorText }], isError: true }
    }
  }

  const toModelOutput = ({ output }: { output: unknown }) => {
    const result = output as { content: ContentBlock[]; isError: boolean }
    if (result.isError) {
      const text = result.content
        .filter((c): c is ContentBlock & { type: 'text' } => c.type === 'text')
        .map((c) => c.text)
        .join('\n')
      return { type: 'error-text' as const, value: text }
    }
    return contentToModelOutput(result.content)
  }

  return {
    click: tool({
      description:
        'Click a visible page target. Provide a concise visual prompt describing what to click; a GUI model locates it on screen.',
      inputSchema: z.object({
        page: pageParam,
        prompt: promptParam,
        button: z.enum(['left', 'right', 'middle']).default('left'),
        clickCount: z.number().default(1).describe('2 for double-click'),
      }),
      execute: (params) =>
        runPointingTool(
          'click',
          (point: { x: number; y: number }) =>
            browser.clickAt(params.page, point.x, point.y, {
              button: params.button,
              clickCount: params.clickCount,
            }),
          (point) =>
            `Clicked "${params.prompt}" at (${Math.round(point.x)}, ${Math.round(point.y)})`,
          params.prompt,
          params.page,
        ),
      toModelOutput,
    }),
    hover: tool({
      description:
        'Hover over a visible page target. Provide a concise visual prompt describing what to hover.',
      inputSchema: z.object({ page: pageParam, prompt: promptParam }),
      execute: (params) =>
        runPointingTool(
          'hover',
          (point: { x: number; y: number }) =>
            browser.hoverAt(params.page, point.x, point.y),
          (point) =>
            `Hovered "${params.prompt}" at (${Math.round(point.x)}, ${Math.round(point.y)})`,
          params.prompt,
          params.page,
        ),
      toModelOutput,
    }),
    type: tool({
      description:
        'Type text into a visible field. Provide a visual prompt describing the field; it is clicked to focus, then the text is typed.',
      inputSchema: z.object({
        page: pageParam,
        prompt: promptParam,
        text: z.string().describe('Text to type into the field'),
        clear: z.boolean().default(false).describe('Clear field before typing'),
      }),
      execute: (params) =>
        runPointingTool(
          'type',
          (point: { x: number; y: number }) =>
            browser.typeAt(
              params.page,
              point.x,
              point.y,
              params.text,
              params.clear,
            ),
          (point) =>
            `Typed ${params.text.length} chars into "${params.prompt}" at (${Math.round(point.x)}, ${Math.round(point.y)})`,
          params.prompt,
          params.page,
        ),
      toModelOutput,
    }),
  }
}

function readOnlyGuard(
  def: BrowserToolDefinition,
  params: unknown,
  options: BrowserToolSetOptions,
): BrowserToolResult | null {
  if (!options.readOnly || def.name !== 'tabs') return null
  const action =
    params &&
    typeof params === 'object' &&
    'action' in params &&
    typeof params.action === 'string'
      ? params.action
      : 'list'
  if (action === 'list') return null
  return errorResult('tabs: chat mode only supports action="list".')
}
