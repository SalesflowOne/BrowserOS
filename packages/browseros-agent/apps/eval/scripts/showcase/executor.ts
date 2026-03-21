import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { AiSdkAgent } from '@browseros/server/agent/tool-loop'
import type { ResolvedAgentConfig } from '@browseros/server/agent/types'
import { Browser } from '@browseros/server/browser'
import { CdpBackend } from '@browseros/server/browser/backends/cdp'
import { registry } from '@browseros/server/tools/registry'
import type { Task } from '../../src/types'
import { injectCrosshair, removeCrosshair } from './crosshair'
import { buildTaskManifest, saveTaskManifest } from './manifest'
import type { ShowcaseStep, ShowcaseTaskManifest } from './types'

const ELEMENT_TOOLS = new Set([
  'click',
  'fill',
  'hover',
  'clear',
  'select_option',
  'drag',
  'focus',
  'check',
  'uncheck',
])

const COORDINATE_TOOLS = new Set(['click_at', 'hover_at', 'type_at', 'drag_at'])

const CONTROLLER_STUB = {
  start: async () => {},
  stop: async () => {},
  isConnected: () => false,
  send: async () => ({}),
  // biome-ignore lint/suspicious/noExplicitAny: ControllerBackend type not exported
} as any

export interface ExecuteTaskResult {
  manifest: ShowcaseTaskManifest
  status: 'completed' | 'timeout' | 'failed'
}

export async function executeShowcaseTask(
  task: Task,
  cdpPort: number,
  outputDir: string,
  agentConfig: { model: string; provider: string; apiKey?: string },
  timeoutMs: number,
): Promise<ExecuteTaskResult> {
  const executionId = randomUUID()
  const taskDir = join(outputDir, executionId)
  const screenshotDir = join(taskDir, 'screenshots')
  await mkdir(screenshotDir, { recursive: true })

  const cdp = new CdpBackend({ port: cdpPort })
  await cdp.connect()
  const browser = new Browser(cdp, CONTROLLER_STUB)

  const pages = await browser.listPages()
  const activePage = pages[0]
  const activePageId = activePage?.pageId ?? 1

  // Navigate to start URL
  if (task.start_url && task.start_url !== 'about:blank') {
    await browser.goto(activePageId, task.start_url)
  }

  const conversationId = randomUUID()
  const resolvedConfig: ResolvedAgentConfig = {
    conversationId,
    // biome-ignore lint/suspicious/noExplicitAny: LLMProvider type validated at runtime
    provider: agentConfig.provider as any,
    model: agentConfig.model,
    apiKey: agentConfig.apiKey,
    workingDir: `/tmp/browseros-showcase-${conversationId}`,
    evalMode: true,
    supportsImages: true,
  }

  const browserContext = activePage
    ? {
        activeTab: {
          id: activePage.tabId,
          pageId: activePage.pageId,
          url: activePage.url,
          title: activePage.title,
        },
      }
    : undefined

  let agent: AiSdkAgent | null = null
  const steps: ShowcaseStep[] = []
  let stepNum = 0
  let finalText: string | null = null
  let status: 'completed' | 'timeout' | 'failed' = 'completed'
  const startTime = Date.now()

  try {
    agent = await AiSdkAgent.create({
      resolvedConfig,
      browser,
      registry,
      browserContext,
    })

    let pendingStep: Partial<ShowcaseStep> | null = null

    const abortController = new AbortController()
    const timeoutHandle = setTimeout(() => abortController.abort(), timeoutMs)

    try {
      const result = await agent.toolLoopAgent.generate({
        prompt: task.query,
        abortSignal: abortController.signal,

        experimental_onToolCallStart: async ({ toolCall }) => {
          try {
            const input = (toolCall.input ?? {}) as Record<string, unknown>
            const pageId =
              typeof input.page === 'number' ? input.page : activePageId

            const beforeResult = await browser.screenshot(pageId, {
              format: 'png',
              fullPage: false,
            })
            const beforePath = join(screenshotDir, `${stepNum}_before.png`)
            await writeFile(
              beforePath,
              Buffer.from(beforeResult.data, 'base64'),
            )

            let axTree = ''
            try {
              axTree = await browser.snapshot(pageId)
            } catch {
              // snapshot can fail on some pages
            }

            let coords: { x: number; y: number } | undefined
            const elementId = input.element as number | undefined
            if (
              elementId !== undefined &&
              ELEMENT_TOOLS.has(toolCall.toolName)
            ) {
              try {
                coords = await browser.getElementCenter(pageId, elementId)
              } catch {
                // element may have been removed
              }
            } else if (
              COORDINATE_TOOLS.has(toolCall.toolName) &&
              typeof input.x === 'number' &&
              typeof input.y === 'number'
            ) {
              coords = { x: input.x, y: input.y }
            }

            pendingStep = {
              stepIndex: stepNum,
              toolName: toolCall.toolName,
              toolInput: input,
              beforeScreenshot: beforePath,
              accessibilitySnapshot: axTree,
              elementCoordinates: coords,
              timestamp: new Date().toISOString(),
            }

            if (coords) {
              try {
                await injectCrosshair(
                  browser,
                  pageId,
                  coords,
                  toolCall.toolName,
                )
                const annotatedResult = await browser.screenshot(pageId, {
                  format: 'png',
                  fullPage: false,
                })
                const annotatedPath = join(
                  screenshotDir,
                  `${stepNum}_annotated.png`,
                )
                await writeFile(
                  annotatedPath,
                  Buffer.from(annotatedResult.data, 'base64'),
                )
                pendingStep.annotatedScreenshot = annotatedPath
                await removeCrosshair(browser, pageId)
              } catch {
                // annotation is best-effort
              }
            }
          } catch (err) {
            console.warn(
              `  Step ${stepNum} before-capture failed: ${err instanceof Error ? err.message : String(err)}`,
            )
          }
        },

        experimental_onToolCallFinish: async ({ toolResult }) => {
          try {
            const afterResult = await browser.screenshot(activePageId, {
              format: 'png',
              fullPage: false,
            })
            const afterPath = join(screenshotDir, `${stepNum}_after.png`)
            await writeFile(afterPath, Buffer.from(afterResult.data, 'base64'))

            if (pendingStep) {
              pendingStep.afterScreenshot = afterPath
              pendingStep.toolOutput = toolResult
              steps.push(pendingStep as ShowcaseStep)
              stepNum++
            }
          } catch (err) {
            console.warn(
              `  Step ${stepNum} after-capture failed: ${err instanceof Error ? err.message : String(err)}`,
            )
          }
          pendingStep = null
        },

        onStepFinish: async ({ text }) => {
          if (text && steps.length > 0) {
            const lastStep = steps[steps.length - 1]
            lastStep.assistantText = text
          }
        },
      })

      finalText = result.text || null
    } catch (err) {
      if (abortController.signal.aborted) {
        status = 'timeout'
        console.log(`  ${task.query_id}: timed out after ${timeoutMs / 1000}s`)
      } else {
        status = 'failed'
        console.error(
          `  ${task.query_id}: failed — ${err instanceof Error ? err.message : String(err)}`,
        )
      }
    } finally {
      clearTimeout(timeoutHandle)
    }

    const totalDurationMs = Date.now() - startTime

    const manifest = buildTaskManifest({
      executionId,
      taskId: task.query_id,
      query: task.query,
      startUrl: task.start_url ?? 'about:blank',
      dataset: task.dataset,
      steps,
      finalAnswer: finalText,
      model: agentConfig.model,
      provider: agentConfig.provider,
      totalDurationMs,
    })

    await saveTaskManifest(outputDir, executionId, manifest)

    return { manifest, status }
  } finally {
    if (agent) await agent.dispose().catch(() => {})
    await cdp.disconnect().catch(() => {})
  }
}
