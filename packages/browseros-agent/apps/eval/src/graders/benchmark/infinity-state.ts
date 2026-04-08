import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { GraderResult } from '../../types'
import type { Grader, GraderInput } from '../types'

interface InfinityEvalInput {
  app_server_url: string
  verifier_path: string
  task_id: string
}

interface InfinityEvalOutput {
  pass: boolean
  reward: number
  message: string
  state_snapshot?: Record<string, unknown> | null
}

interface TaskMetadataFile {
  query_id: string
  dataset: string
  additional?: {
    app_name?: string
    app_port?: number
    verifier_path?: string
    difficulty?: string
  }
}

const EVAL_SCRIPT = resolve(
  import.meta.dir,
  '../../../scripts/infinity-evaluate.py',
)

export class InfinityStateGrader implements Grader {
  name = 'infinity_state'

  async grade(input: GraderInput): Promise<GraderResult> {
    let metadata: TaskMetadataFile
    try {
      const raw = await readFile(
        join(input.outputDir, 'metadata.json'),
        'utf-8',
      )
      metadata = JSON.parse(raw)
    } catch (error) {
      return {
        score: 0,
        pass: false,
        reasoning: `Failed to read task metadata: ${error}`,
      }
    }

    const additional = metadata.additional
    if (!additional?.app_port || !additional?.verifier_path) {
      return {
        score: 0,
        pass: false,
        reasoning:
          'Missing app_port or verifier_path in task metadata.additional',
      }
    }

    const evalInput: InfinityEvalInput = {
      app_server_url: `http://localhost:${additional.app_port}`,
      verifier_path: additional.verifier_path,
      task_id: metadata.query_id,
    }

    try {
      const result = await this.runPythonEvaluator(evalInput)
      return {
        score: result.pass ? 1 : 0,
        pass: result.pass,
        reasoning: result.message,
        details: {
          reward: result.reward,
          state_snapshot: result.state_snapshot,
          app_name: additional.app_name,
          difficulty: additional.difficulty,
        },
      }
    } catch (error) {
      return {
        score: 0,
        pass: false,
        reasoning: `Evaluator process error: ${error instanceof Error ? error.message : String(error)}`,
      }
    }
  }

  private async runPythonEvaluator(
    evalInput: InfinityEvalInput,
  ): Promise<InfinityEvalOutput> {
    const proc = Bun.spawn(['python3', EVAL_SCRIPT], {
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
    })

    const inputJson = JSON.stringify(evalInput)
    proc.stdin.write(inputJson)
    proc.stdin.end()

    const stdout = await new Response(proc.stdout).text()
    const stderr = await new Response(proc.stderr).text()
    const exitCode = await proc.exited

    if (exitCode !== 0) {
      throw new Error(
        `Python evaluator exited with code ${exitCode}: ${stderr || stdout}`,
      )
    }

    return JSON.parse(stdout.trim()) as InfinityEvalOutput
  }
}
