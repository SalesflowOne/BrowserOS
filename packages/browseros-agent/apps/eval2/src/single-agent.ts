import { randomUUID } from 'node:crypto'
import {
  AiSdkAgent,
  formatUserMessage,
} from '@browseros/server/agent/tool-loop'
import type { ResolvedAgentConfig } from '@browseros/server/agent/types'
import { Browser } from '@browseros/server/browser'
import { CdpBackend } from '@browseros/server/browser/backends/cdp'
import { registry } from '@browseros/server/tools/registry'
import type { BrowserContext } from '@browseros/shared/schemas/browser-context'
import { LLM_PROVIDERS } from '@browseros/shared/schemas/llm'
import type { BenchmarkConfig } from './benchmark-config'
import { getAiSdkTelemetry, logScreenshot } from './tracing'
import type { AgentResult, Message, Task } from './types'
import { callMcpTool } from './utils/mcp-client'

const MUTATING_TOOLS = new Set([
  'click',
  'click_at',
  'fill',
  'navigate_page',
  'scroll',
  'press_key',
  'select_option',
  'drag',
  'drag_at',
  'type_at',
])

export interface SingleAgentDeps {
  config: BenchmarkConfig
  serverUrl: string
  runId: string
}

export class SingleAgent {
  private readonly config: BenchmarkConfig
  private readonly serverUrl: string
  private readonly mcpUrl: string
  private readonly runId: string
  private cdp: CdpBackend | null = null
  private browser: Browser | null = null
  private activePageId = 1

  constructor(deps: SingleAgentDeps) {
    this.config = deps.config
    this.serverUrl = deps.serverUrl
    this.mcpUrl = `${deps.serverUrl}/mcp`
    this.runId = deps.runId
  }

  private async ensureConnected(): Promise<void> {
    if (this.browser) {
      return
    }

    this.cdp = new CdpBackend({ port: this.config.ports.cdp })
    await this.cdp.connect()
    this.browser = new Browser(this.cdp)
    const pages = await this.browser.listPages()
    this.activePageId = pages[0]?.pageId ?? 1
  }

  private async getBrowserContext(): Promise<BrowserContext> {
    if (!this.browser) {
      throw new Error('SingleAgent: browser not initialized')
    }

    const pages = await this.browser.listPages()
    const activePage =
      pages.find((page) => page.pageId === this.activePageId) ?? pages[0]
    if (activePage) {
      this.activePageId = activePage.pageId
      return {
        activeTab: {
          id: activePage.tabId,
          pageId: activePage.pageId,
          url: activePage.url,
          title: activePage.title,
        },
      }
    }

    return {
      activeTab: {
        id: this.activePageId,
        pageId: this.activePageId,
        url: 'about:blank',
        title: '',
      },
    }
  }

  private async navigateToStartUrl(task: Task): Promise<void> {
    if (!task.startUrl || task.startUrl === 'about:blank') {
      return
    }

    await callMcpTool(this.mcpUrl, 'navigate_page', {
      url: task.startUrl,
      page: this.activePageId,
    })
  }

  async runTask(task: Task): Promise<AgentResult> {
    await this.ensureConnected()
    if (!this.browser) {
      throw new Error('SingleAgent: browser not initialized')
    }

    await this.navigateToStartUrl(task)
    const browserContext = await this.getBrowserContext()
    const apiKey = process.env[this.config.apiKeyEnv]
    if (!apiKey) {
      throw new Error(`Missing ${this.config.apiKeyEnv}`)
    }

    const conversationId = randomUUID()
    const resolvedConfig: ResolvedAgentConfig = {
      provider: LLM_PROVIDERS.OPENAI,
      model: this.config.model,
      apiKey,
      conversationId,
      workingDir: `/tmp/browseros-eval2-${conversationId}`,
      evalMode: true,
      supportsImages: true,
    }

    const agent = await AiSdkAgent.create({
      resolvedConfig,
      browser: this.browser,
      registry,
      browserContext,
      aiSdkTelemetry: getAiSdkTelemetry(
        task,
        this.config,
        this.runId,
        conversationId,
      ),
    })

    const messages: Message[] = [{ type: 'user', content: task.query }]
    let toolCallCount = 0
    let terminationReason: AgentResult['terminationReason'] = 'done'
    let finalAnswer: string | null = null
    let lastToolName: string | null = null
    const controller = new AbortController()
    const timeoutHandle = setTimeout(() => {
      controller.abort()
    }, this.config.timeoutMs)
    const screenshotMode = this.config.langfuse.screenshotMode

    try {
      const prompt = formatUserMessage(task.query, browserContext)
      const result = await agent.toolLoopAgent.generate({
        prompt,
        abortSignal: controller.signal,
        experimental_onToolCallStart: ({ toolCall }) => {
          // remember tool name for the matching onToolCallFinish + track active page
          lastToolName = toolCall.toolName
          const input = toolCall.input as Record<string, unknown> | undefined
          if (input && typeof input.page === 'number') {
            this.activePageId = input.page
          }
        },
        experimental_onToolCallFinish: async () => {
          // capture screenshot after each tool runs - non-fatal on failure
          if (screenshotMode === 'never' || !this.browser || !lastToolName) {
            return
          }
          if (
            screenshotMode === 'mutating-only' &&
            !MUTATING_TOOLS.has(lastToolName)
          ) {
            return
          }
          try {
            const shot = await this.browser.screenshot(this.activePageId, {
              format: 'png',
              fullPage: false,
            })
            const pages = await this.browser.listPages()
            const pageUrl = pages.find(
              (page) => page.pageId === this.activePageId,
            )?.url
            await logScreenshot(
              lastToolName,
              Buffer.from(shot.data, 'base64'),
              pageUrl,
            )
          } catch {
            // screenshot failures never fail a task
          }
        },
        onStepFinish: ({ toolCalls, toolResults, text }) => {
          toolCallCount += toolCalls.length
          for (const toolCall of toolCalls) {
            messages.push({
              type: 'tool-input-available',
              toolCallId: toolCall.toolCallId,
              toolName: toolCall.toolName,
              input: toolCall.input,
            })
          }

          for (const toolResult of toolResults) {
            messages.push({
              type: 'tool-output-available',
              toolCallId: toolResult.toolCallId,
              output: toolResult.output,
            })
          }

          if (text) {
            messages.push({ type: 'text', text })
          }
        },
      })
      finalAnswer = result.text || null
    } catch (error) {
      if (controller.signal.aborted) {
        terminationReason = 'timeout'
      } else {
        terminationReason = 'error'
        console.warn(
          `Task ${task.queryId} failed mid-run: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    } finally {
      clearTimeout(timeoutHandle)
      await agent.dispose().catch(() => {})
    }

    return { finalAnswer, messages, terminationReason, toolCallCount }
  }

  async cleanup(): Promise<void> {
    if (!this.browser) {
      return
    }

    await callMcpTool(this.mcpUrl, 'navigate_page', {
      url: 'about:blank',
      page: this.activePageId,
    }).catch(() => {})
  }

  async dispose(): Promise<void> {
    await this.cdp?.disconnect().catch(() => {})
    this.cdp = null
    this.browser = null
  }
}
