/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

const isLinux = process.platform === 'linux'

export class PodmanRuntime {
  private podmanPath: string
  private machineReady = false

  constructor(config?: { podmanPath?: string }) {
    this.podmanPath = config?.podmanPath ?? 'podman'
  }

  getPodmanPath(): string {
    return this.podmanPath
  }

  async isPodmanAvailable(): Promise<boolean> {
    try {
      const proc = Bun.spawn([this.podmanPath, '--version'], {
        stdout: 'ignore',
        stderr: 'ignore',
      })
      const code = await proc.exited
      return code === 0
    } catch {
      return false
    }
  }

  async getMachineStatus(): Promise<{
    initialized: boolean
    running: boolean
  }> {
    if (isLinux) return { initialized: true, running: true }

    try {
      const proc = Bun.spawn(
        [this.podmanPath, 'machine', 'list', '--format', 'json'],
        { stdout: 'pipe', stderr: 'ignore' },
      )
      const output = await new Response(proc.stdout).text()
      await proc.exited

      const machines = JSON.parse(output) as Array<{
        Running?: boolean
        LastUp?: string
      }>

      if (!machines.length) return { initialized: false, running: false }

      const machine = machines[0]
      const running =
        machine.Running === true || machine.LastUp === 'Currently running'

      return { initialized: true, running }
    } catch {
      return { initialized: false, running: false }
    }
  }

  async initMachine(onLog?: (msg: string) => void): Promise<void> {
    if (isLinux) return

    const proc = Bun.spawn(
      [
        this.podmanPath,
        'machine',
        'init',
        '--cpus',
        '2',
        '--memory',
        '2048',
        '--disk-size',
        '10',
      ],
      { stdout: 'ignore', stderr: 'pipe' },
    )

    if (onLog && proc.stderr) {
      const reader = proc.stderr.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          const trimmed = line.trim()
          if (trimmed) onLog(trimmed)
        }
      }
      if (buffer.trim()) onLog(buffer.trim())
    }

    const code = await proc.exited
    if (code !== 0)
      throw new Error(`podman machine init failed with code ${code}`)
  }

  async startMachine(onLog?: (msg: string) => void): Promise<void> {
    if (isLinux) return

    const proc = Bun.spawn([this.podmanPath, 'machine', 'start'], {
      stdout: 'ignore',
      stderr: 'pipe',
    })

    if (onLog && proc.stderr) {
      const reader = proc.stderr.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          const trimmed = line.trim()
          if (trimmed) onLog(trimmed)
        }
      }
      if (buffer.trim()) onLog(buffer.trim())
    }

    const code = await proc.exited
    if (code !== 0)
      throw new Error(`podman machine start failed with code ${code}`)
  }

  async stopMachine(): Promise<void> {
    if (isLinux) return

    const proc = Bun.spawn([this.podmanPath, 'machine', 'stop'], {
      stdout: 'ignore',
      stderr: 'ignore',
    })
    const code = await proc.exited
    if (code !== 0)
      throw new Error(`podman machine stop failed with code ${code}`)
    this.machineReady = false
  }

  async ensureReady(onLog?: (msg: string) => void): Promise<void> {
    if (this.machineReady) return

    const status = await this.getMachineStatus()

    if (!status.initialized) {
      onLog?.('Initializing Podman machine...')
      await this.initMachine(onLog)
    }

    if (!status.running) {
      onLog?.('Starting Podman machine...')
      await this.startMachine(onLog)
    }

    this.machineReady = true
  }

  async runCommand(
    args: string[],
    options?: {
      cwd?: string
      env?: Record<string, string>
      onOutput?: (line: string) => void
    },
  ): Promise<number> {
    const useStreaming = !!options?.onOutput
    const proc = Bun.spawn([this.podmanPath, ...args], {
      cwd: options?.cwd,
      env: options?.env ? { ...process.env, ...options.env } : undefined,
      stdout: useStreaming ? 'pipe' : 'ignore',
      stderr: useStreaming ? 'pipe' : 'ignore',
    })

    if (options?.onOutput) {
      const streamLines = async (stream: ReadableStream<Uint8Array> | null) => {
        if (!stream) return
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
            const trimmed = line.trim()
            if (trimmed) options.onOutput!(trimmed)
          }
        }
        if (buffer.trim()) options.onOutput!(buffer.trim())
      }

      await Promise.all([streamLines(proc.stdout), streamLines(proc.stderr)])
    }

    return proc.exited
  }
}

let runtime: PodmanRuntime | null = null

export function getPodmanRuntime(): PodmanRuntime {
  if (!runtime) runtime = new PodmanRuntime()
  return runtime
}
