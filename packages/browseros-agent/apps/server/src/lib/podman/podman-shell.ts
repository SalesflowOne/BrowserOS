/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { PodmanCommandError } from '../vm/errors'
import type { ContainerSpec, LogFn, MountSpec, PortMapping } from './types'

export interface PodmanShellConfig {
  limactlPath: string
  limaHome: string
  vmName: string
}

interface CommandResult {
  exitCode: number
  stdout: string
  stderr: string
}

export class PodmanShell {
  constructor(private readonly cfg: PodmanShellConfig) {}

  async imageExists(ref: string): Promise<boolean> {
    const result = await this.run(['image', 'inspect', ref])
    return result.exitCode === 0
  }

  async pullImage(ref: string, onLog?: LogFn): Promise<void> {
    await this.runRequired(['pull', ref], onLog)
  }

  async loadImage(tarballPath: string, onLog?: LogFn): Promise<string[]> {
    const result = await this.runRequired(['load', '-i', tarballPath], onLog)
    return parseLoadedImageRefs(result.stdout)
  }

  async createContainer(spec: ContainerSpec, onLog?: LogFn): Promise<void> {
    await this.runRequired(buildCreateArgs(spec), onLog)
  }

  async startContainer(name: string, onLog?: LogFn): Promise<void> {
    await this.runRequired(['start', name], onLog)
  }

  async stopContainer(name: string, onLog?: LogFn): Promise<void> {
    const result = await this.run(['stop', name], onLog)
    if (result.exitCode === 0 || isNoSuchContainer(result.stderr)) return
    throw this.commandError(['stop', name], result)
  }

  async removeContainer(
    name: string,
    opts?: { force?: boolean },
    onLog?: LogFn,
  ): Promise<void> {
    const args = ['rm']
    if (opts?.force) args.push('-f')
    args.push('--ignore', name)
    await this.runRequired(args, onLog)
  }

  async exec(name: string, cmd: string[], onLog?: LogFn): Promise<number> {
    const result = await this.run(['exec', name, ...cmd], onLog)
    return result.exitCode
  }

  async ps(opts?: { namesOnly?: boolean }): Promise<string[]> {
    const args = opts?.namesOnly ? ['ps', '--format', '{{.Names}}'] : ['ps']
    const result = await this.runRequired(args)
    return result.stdout
      .trim()
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
  }

  tailLogs(name: string, onLine: LogFn): () => void {
    const proc = Bun.spawn(this.argv(['logs', '-f', '--tail', '0', name]), {
      cwd: '/',
      env: this.env(),
      stdout: 'pipe',
      stderr: 'pipe',
    })
    void drainStream(proc.stdout ?? null, onLine)
    void drainStream(proc.stderr ?? null, onLine)

    let stopped = false
    return () => {
      if (stopped) return
      stopped = true
      try {
        proc.kill()
      } catch {
        return
      }
    }
  }

  private async runRequired(
    args: string[],
    onLog?: LogFn,
  ): Promise<CommandResult> {
    const result = await this.run(args, onLog)
    if (result.exitCode === 0) return result
    throw this.commandError(args, result)
  }

  private async run(args: string[], onLog?: LogFn): Promise<CommandResult> {
    const proc = Bun.spawn(this.argv(args), {
      cwd: '/',
      env: this.env(),
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const stdoutLines: string[] = []
    const stderrLines: string[] = []
    const [stdout, stderr, exitCode] = await Promise.all([
      drainStream(proc.stdout ?? null, (line) => {
        stdoutLines.push(line)
        onLog?.(line)
      }),
      drainStream(proc.stderr ?? null, (line) => {
        stderrLines.push(line)
        onLog?.(line)
      }),
      proc.exited,
    ])

    return {
      exitCode,
      stdout:
        stdout || `${stdoutLines.join('\n')}${stdoutLines.length ? '\n' : ''}`,
      stderr: stderr || stderrLines.join('\n'),
    }
  }

  private argv(podmanArgs: string[]): string[] {
    return [
      this.cfg.limactlPath,
      'shell',
      this.cfg.vmName,
      '--',
      'podman',
      ...podmanArgs,
    ]
  }

  private env(): NodeJS.ProcessEnv {
    return { ...process.env, LIMA_HOME: this.cfg.limaHome }
  }

  private commandError(
    args: string[],
    result: CommandResult,
  ): PodmanCommandError {
    return new PodmanCommandError(
      `podman ${args.join(' ')}`,
      result.exitCode,
      result.stderr.trim(),
    )
  }
}

function buildCreateArgs(spec: ContainerSpec): string[] {
  const args = ['create', '--name', spec.name]

  if (spec.restart) args.push('--restart', spec.restart)
  for (const port of spec.ports ?? []) args.push('-p', portArg(port))
  if (spec.envFile) args.push('--env-file', spec.envFile)
  for (const [key, value] of Object.entries(spec.env ?? {})) {
    args.push('-e', `${key}=${value}`)
  }
  for (const mount of spec.mounts ?? []) args.push('-v', mountArg(mount))
  for (const host of spec.addHosts ?? []) args.push('--add-host', host)
  if (spec.health) {
    args.push('--health-cmd', spec.health.cmd)
    if (spec.health.interval)
      args.push('--health-interval', spec.health.interval)
    if (spec.health.timeout) args.push('--health-timeout', spec.health.timeout)
    if (spec.health.retries !== undefined) {
      args.push('--health-retries', String(spec.health.retries))
    }
  }

  args.push(spec.image)
  args.push(...(spec.command ?? []))
  return args
}

function portArg(port: PortMapping): string {
  const host = port.hostIp ? `${port.hostIp}:${port.hostPort}` : port.hostPort
  return `${host}:${port.containerPort}`
}

function mountArg(mount: MountSpec): string {
  return `${mount.source}:${mount.target}${mount.readonly ? ':ro' : ''}`
}

function parseLoadedImageRefs(stdout: string): string[] {
  return stdout
    .split('\n')
    .map((line) => line.match(/^Loaded image(?:\(s\))?:\s*(.+)$/i)?.[1]?.trim())
    .filter((ref): ref is string => !!ref)
}

function isNoSuchContainer(stderr: string): boolean {
  return stderr.toLowerCase().includes('no such container')
}

async function drainStream(
  stream: ReadableStream<Uint8Array> | null,
  onLine: LogFn,
): Promise<string> {
  if (!stream) return ''
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let output = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    const chunk = decoder.decode(value, { stream: true })
    output += chunk
    buffer += chunk
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (line.trim()) onLine(line.trim())
    }
  }

  if (buffer.trim()) onLine(buffer.trim())
  return output
}
