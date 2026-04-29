import { readFile } from 'node:fs/promises'
import { dirname, isAbsolute, resolve } from 'node:path'
import { z } from 'zod'

export const BenchmarkConfigSchema = z.object({
  name: z.string(),
  dataset: z.string(),
  provider: z.literal('openai'),
  model: z.string(),
  apiKeyEnv: z.string(),
  browserosBinary: z.string(),
  ports: z.object({
    cdp: z.number().int().positive(),
    server: z.number().int().positive(),
    extension: z.number().int().positive(),
  }),
  timeoutMs: z.number().int().positive().default(600_000),
  maxTasks: z.number().int().positive().optional(),
  langfuse: z.object({
    enabled: z.boolean(),
    sessionPrefix: z.string(),
    screenshotMode: z.enum(['all', 'mutating-only', 'never']).default('all'),
  }),
})

export type BenchmarkConfig = z.infer<typeof BenchmarkConfigSchema>

export interface LoadedConfig {
  config: BenchmarkConfig
  configDir: string
  datasetPath: string
}

function stripJsonComments(content: string): string {
  let output = ''
  let inString = false
  let escaped = false

  for (let index = 0; index < content.length; index++) {
    const char = content[index]
    const next = content[index + 1]

    if (inString) {
      output += char
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === '"') {
        inString = false
      }
      continue
    }

    if (char === '"') {
      inString = true
      output += char
      continue
    }

    if (char === '/' && next === '/') {
      while (index < content.length && content[index] !== '\n') {
        index++
      }
      output += '\n'
      continue
    }

    output += char
  }

  return output
}

export async function loadBenchmarkConfig(
  configPath: string,
): Promise<LoadedConfig> {
  const absoluteConfigPath = isAbsolute(configPath)
    ? configPath
    : resolve(process.cwd(), configPath)
  const raw = await readFile(absoluteConfigPath, 'utf-8')
  const parsed: unknown = JSON.parse(stripJsonComments(raw))
  const config = BenchmarkConfigSchema.parse(parsed)

  const configDir = dirname(absoluteConfigPath)
  const datasetPath = isAbsolute(config.dataset)
    ? config.dataset
    : resolve(configDir, config.dataset)

  if (!process.env[config.apiKeyEnv]) {
    throw new Error(
      `Missing required env var: ${config.apiKeyEnv}. Set it in .env.development or your shell.`,
    )
  }

  return { config, configDir, datasetPath }
}
