import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import { parse } from 'yaml'
import { z } from 'zod'
import { COCKPIT_CDP_PORT_DEFAULT, PROD_API_PORT } from './shared/port'

const portSchema = z.number().int().min(1).max(65535)
const ClawConfigSchema = z.object({
  port: portSchema,
  cdpPort: portSchema,
})

export type ClawConfig = z.infer<typeof ClawConfigSchema>
export type ConfigResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string }

interface LoadClawConfigOptions {
  argv?: string[]
  cwd?: string
  env?: Record<string, string | undefined>
}

type PartialClawConfig = Partial<ClawConfig>

/** Loads and validates Claw server ports from defaults, env, and YAML config. */
export function loadClawConfig(
  options: LoadClawConfigOptions = {},
): ConfigResult<ClawConfig> {
  const argv = options.argv ?? process.argv
  const cwd = options.cwd ?? process.cwd()
  // biome-ignore lint/style/noProcessEnv: config.ts is the sanctioned Claw config reader
  const runtimeEnv = options.env ?? process.env

  const cli = parseCliArgs(argv)
  if (!cli.ok) return cli

  const envConfig = parseRuntimeEnv(runtimeEnv)
  if (!envConfig.ok) return envConfig

  const configPath = cli.value.configPath ?? cleanString(runtimeEnv.CLAW_CONFIG)
  const fileConfig = parseConfigFile(configPath, cwd)
  if (!fileConfig.ok) return fileConfig

  const result = ClawConfigSchema.safeParse(
    mergeConfigs(getDefaults(), fileConfig.value, envConfig.value),
  )
  if (!result.success) {
    const errors = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n')
    return {
      ok: false,
      error: `Invalid Claw server configuration:\n${errors}`,
    }
  }

  return { ok: true, value: result.data }
}

function parseCliArgs(argv: string[]): ConfigResult<{ configPath?: string }> {
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]
    if (arg === '--config') {
      const value = argv[index + 1]
      if (!value || value.startsWith('--')) {
        return { ok: false, error: '--config requires a path' }
      }
      return { ok: true, value: { configPath: value } }
    }
    if (arg.startsWith('--config=')) {
      const value = arg.slice('--config='.length).trim()
      if (!value) return { ok: false, error: '--config requires a path' }
      return { ok: true, value: { configPath: value } }
    }
  }

  return { ok: true, value: {} }
}

function parseRuntimeEnv(
  env: Record<string, string | undefined>,
): ConfigResult<PartialClawConfig> {
  const port = parsePort(env.CLAW_SERVER_PORT, 'CLAW_SERVER_PORT')
  if (!port.ok) return port

  const cdpPort = parsePort(
    env.BROWSEROS_CLAW_CDP_PORT,
    'BROWSEROS_CLAW_CDP_PORT',
  )
  if (!cdpPort.ok) return cdpPort

  return {
    ok: true,
    value: omitUndefined({
      port: port.value,
      cdpPort: cdpPort.value,
    }),
  }
}

function parseConfigFile(
  filePath: string | undefined,
  cwd: string,
): ConfigResult<PartialClawConfig> {
  if (!filePath) return { ok: true, value: {} }

  const absPath = isAbsolute(filePath) ? filePath : resolve(cwd, filePath)
  if (!existsSync(absPath)) {
    return { ok: false, error: `Config file not found: ${absPath}` }
  }

  let raw: unknown
  try {
    raw = parse(readFileSync(absPath, 'utf-8'))
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, error: `Config file error: ${message}` }
  }

  if (raw == null) return { ok: true, value: {} }
  if (!isRecord(raw)) {
    return { ok: false, error: 'Config file error: expected a YAML mapping' }
  }

  const ports = raw.ports
  if (ports === undefined) return { ok: true, value: {} }
  if (!isRecord(ports)) {
    return { ok: false, error: 'Config file error: ports must be a mapping' }
  }
  const unknownPortKeys = Object.keys(ports).filter(
    (key) => key !== 'server' && key !== 'cdp',
  )
  if (unknownPortKeys.length > 0) {
    return {
      ok: false,
      error: `Config file error: unknown ports key(s): ${unknownPortKeys.join(', ')}`,
    }
  }

  const port = parsePort(ports.server, 'ports.server')
  if (!port.ok) return port

  const cdpPort = parsePort(ports.cdp, 'ports.cdp')
  if (!cdpPort.ok) return cdpPort

  return {
    ok: true,
    value: omitUndefined({
      port: port.value,
      cdpPort: cdpPort.value,
    }),
  }
}

function parsePort(
  value: unknown,
  source: string,
): ConfigResult<number | undefined> {
  if (value === undefined || value === null || value === '') {
    return { ok: true, value: undefined }
  }

  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number(value.trim())
        : Number.NaN

  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    return {
      ok: false,
      error: `${source} must be an integer port between 1 and 65535`,
    }
  }

  return { ok: true, value: parsed }
}

function getDefaults(): ClawConfig {
  return {
    port: PROD_API_PORT,
    cdpPort: COCKPIT_CDP_PORT_DEFAULT,
  }
}

function mergeConfigs(...configs: PartialClawConfig[]): PartialClawConfig {
  const result: PartialClawConfig = {}
  for (const config of configs) {
    for (const [key, value] of Object.entries(config)) {
      if (value !== undefined) {
        ;(result as Record<string, unknown>)[key] = value
      }
    }
  }
  return result
}

function omitUndefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, value]) => value !== undefined),
  ) as Partial<T>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function cleanString(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}
