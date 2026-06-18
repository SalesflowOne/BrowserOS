import { join } from 'node:path'
import {
  writeGraderJsonArtifact,
  writeGraderTextArtifact,
} from '../../grading/artifacts'
import {
  type PythonEvaluatorResult,
  runPythonJsonEvaluator,
} from '../../grading/python-evaluator'
import type { GraderResult } from '../../types'
import { callMcpTool } from '../../utils/mcp-client'
import type { Grader, GraderInput } from '../types'

const EVAL_SCRIPT = join(
  import.meta.dirname,
  '..',
  'python',
  'agisdk-evaluate.py',
)

interface AgisdkEvaluatorInput {
  task_id: string
  env_state: Record<string, unknown>
  model_response: string
}

interface AgisdkEvaluatorOutput {
  reward: number
  pass: boolean
  message: string
  per_criterion: unknown[]
}

export class AgisdkStateDiffGrader implements Grader {
  name = 'agisdk_state_diff'

  async grade(input: GraderInput): Promise<GraderResult> {
    const taskId = this.extractTaskId(input.task.query_id)
    const startUrl = this.extractStartUrl(input)
    const mcpEndpoint =
      input.mcpUrl ||
      `${process.env.BROWSEROS_SERVER_URL || 'http://127.0.0.1:9110'}/mcp`

    if (!startUrl) {
      return {
        score: 0,
        pass: false,
        reasoning: 'Could not determine clone site URL from task',
      }
    }

    const origin = new URL(startUrl).origin

    let envState: Record<string, unknown>
    try {
      envState = await this.fetchFinishState(origin, mcpEndpoint)
      await writeGraderJsonArtifact(
        input,
        this.name,
        'finish-state.json',
        envState,
      )
      await writeGraderJsonArtifact(input, this.name, 'context.json', {
        origin,
        agisdk_task_id: taskId,
      })
    } catch (error) {
      return {
        score: 0,
        pass: false,
        reasoning: `Failed to fetch /finish endpoint: ${error instanceof Error ? error.message : String(error)}`,
        details: { origin, error: true },
      }
    }

    try {
      const evaluatorInput: AgisdkEvaluatorInput = {
        task_id: taskId,
        env_state: envState,
        model_response: input.finalAnswer || '',
      }
      await writeGraderJsonArtifact(
        input,
        this.name,
        'evaluator-input.json',
        evaluatorInput,
      )
      const evaluation = await this.runPythonEvaluator(evaluatorInput)
      const result = evaluation.output
      await writeGraderJsonArtifact(
        input,
        this.name,
        'evaluator-output.json',
        result,
      )
      await writeGraderTextArtifact(
        input,
        this.name,
        'stderr.txt',
        evaluation.stderr,
      )
      return {
        score: result.reward,
        pass: result.pass,
        reasoning:
          result.message ||
          (result.pass ? 'All criteria passed' : 'Some criteria failed'),
        details: {
          reward: result.reward,
          per_criterion: result.per_criterion,
          origin,
          agisdk_task_id: taskId,
        },
      }
    } catch (error) {
      return {
        score: 0,
        pass: false,
        reasoning: `Python evaluator error: ${error instanceof Error ? error.message : String(error)}`,
        details: { error: true },
      }
    }
  }

  private extractTaskId(queryId: string): string {
    return queryId.replace(/^agisdk-/, '')
  }

  private extractStartUrl(input: GraderInput): string | null {
    // Derive from task_id: "dashdish-10" → "https://evals-dashdish.vercel.app"
    // Task IDs are "{site}-{number}" where site may contain hyphens (e.g. "fly-unified-5")
    const taskId = this.extractTaskId(input.task.query_id)
    const siteId = taskId.replace(/-\d+$/, '')
    if (siteId) return `https://evals-${siteId}.vercel.app`

    // Fallback: search messages for vercel.app URLs
    for (const msg of input.messages) {
      const text =
        msg.type === 'user'
          ? msg.content
          : msg.type === 'tool-input-available'
            ? JSON.stringify(msg.input)
            : ''
      const urlMatch = text.match(/https?:\/\/[^\s"']+\.vercel\.app/)
      if (urlMatch) return urlMatch[0]
    }

    return null
  }

  private async fetchFinishState(
    origin: string,
    mcpEndpoint: string,
  ): Promise<Record<string, unknown>> {
    const finishUrl = `${origin}/finish`
    // /finish on a state-laden page can be slow to navigate/snapshot; give the
    // MCP calls plenty of headroom above the 65s default.
    const finishTimeoutMs = 180_000

    // Navigate browser to /finish page (state diff is rendered client-side)
    await callMcpTool(
      mcpEndpoint,
      'navigate',
      { url: finishUrl, page: 1, action: 'url' },
      finishTimeoutMs,
    )

    // Wait for the page to render, then extract JSON from <pre> element.
    const result = await callMcpTool(
      mcpEndpoint,
      'run',
      {
        page: 1,
        code: `
        return await new Promise((resolve) => {
          let attempts = 0;
          const check = () => {
            const pre = document.querySelector('pre');
            if (pre && pre.textContent.trim().startsWith('{')) {
              resolve(pre.textContent);
            } else if (++attempts > 60) {
              resolve('NO_FINISH_JSON readyState=' + document.readyState +
                ' title=' + document.title +
                ' bodyLen=' + (document.body ? document.body.innerText.length : 0));
            } else {
              setTimeout(check, 500);
            }
          };
          check();
        })
      `,
      },
      finishTimeoutMs,
    )

    const textContent = result.content?.find(
      (c: { type: string }) => c.type === 'text',
    )
    if (!textContent?.text) {
      throw new Error('No text content returned from /finish page')
    }

    // The new `run` tool wraps output in [UNTRUSTED_PAGE_CONTENT ...] markers,
    // so the JSON payload is embedded, not the whole string. Extract it.
    const raw = textContent.text
    const start = raw.indexOf('{')
    const end = raw.lastIndexOf('}')
    if (start === -1 || end === -1 || end < start) {
      throw new Error(`/finish returned no JSON: ${raw.slice(0, 300)}`)
    }
    return JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>
  }

  private runPythonEvaluator(
    evalInput: AgisdkEvaluatorInput,
  ): Promise<PythonEvaluatorResult<AgisdkEvaluatorOutput>> {
    return runPythonJsonEvaluator<AgisdkEvaluatorOutput>({
      scriptPath: EVAL_SCRIPT,
      input: evalInput,
      timeoutMs: 300_000,
    })
  }
}
