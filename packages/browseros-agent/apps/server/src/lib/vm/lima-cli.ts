/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { LimaCommandError } from './errors'

export interface LimaListEntry {
  name: string
  status: string
  dir: string
}

export interface LimaCliConfig {
  limactlPath: string
  limaHome: string
}

export interface LimaShellStreams {
  onStdout?: (line: string) => void
  onStderr?: (line: string) => void
}

export class LimaCli {
  constructor(private readonly cfg: LimaCliConfig) {}

  async list(): Promise<LimaListEntry[]> {
    const result = await this.run(['list', '--format', 'json'])
    if (!result.stdout.trim()) return []
    return parseLimaList(result.stdout)
  }

  async create(name: string, yamlPath: string): Promise<void> {
    await this.runChecked('create', [
      'create',
      '--tty=false',
      `--name=${name}`,
      yamlPath,
    ])
  }

  async start(name: string): Promise<void> {
    await this.runChecked('start', ['start', '--tty=false', name])
  }

  async stop(name: string): Promise<void> {
    await this.runChecked('stop', ['stop', name])
  }

  async delete(name: string): Promise<void> {
    await this.runChecked('delete', ['delete', '--force', name])
  }

  async shell(
    name: string,
    args: string[],
    streams?: LimaShellStreams,
  ): Promise<number> {
    const proc = Bun.spawn(
      [this.cfg.limactlPath, 'shell', name, '--', ...args],
      {
        cwd: '/',
        env: this.env(),
        stdout: streams?.onStdout ? 'pipe' : 'ignore',
        stderr: streams?.onStderr ? 'pipe' : 'pipe',
      },
    )

    await Promise.all([
      drainStream(proc.stdout ?? null, streams?.onStdout),
      drainStream(proc.stderr ?? null, streams?.onStderr),
    ])
    return proc.exited
  }

  private async runChecked(command: string, args: string[]): Promise<void> {
    const result = await this.run(args)
    if (result.exitCode !== 0) {
      throw new LimaCommandError(
        `limactl ${command}`,
        result.exitCode,
        result.stderr,
      )
    }
  }

  private async run(args: string[]): Promise<{
    exitCode: number
    stdout: string
    stderr: string
  }> {
    const proc = Bun.spawn([this.cfg.limactlPath, ...args], {
      env: this.env(),
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])
    return { exitCode, stdout, stderr }
  }

  private env(): NodeJS.ProcessEnv {
    return { ...process.env, LIMA_HOME: this.cfg.limaHome }
  }
}

function parseLimaList(output: string): LimaListEntry[] {
  const trimmed = output.trim()
  try {
    const parsed = JSON.parse(trimmed) as unknown
    if (Array.isArray(parsed)) return parsed.map(toLimaListEntry)
    return [toLimaListEntry(parsed)]
  } catch {
    return trimmed.split('\n').map((line) => toLimaListEntry(JSON.parse(line)))
  }
}

function toLimaListEntry(input: unknown): LimaListEntry {
  const entry = input as Partial<LimaListEntry>
  return {
    name: entry.name ?? '',
    status: entry.status ?? '',
    dir: entry.dir ?? '',
  }
}

async function drainStream(
  stream: ReadableStream<Uint8Array> | null,
  onLine?: (line: string) => void,
): Promise<void> {
  if (!stream || !onLine) return
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (line.trim()) onLine(line.trim())
    }
  }

  if (buffer.trim()) onLine(buffer.trim())
}
