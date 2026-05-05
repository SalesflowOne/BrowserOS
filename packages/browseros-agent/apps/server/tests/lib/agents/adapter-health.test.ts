/**
 * @license
 * Copyright 2025 BrowserOS
 */

import { describe, expect, it } from 'bun:test'
import { AdapterHealthChecker } from '../../../src/lib/agents/adapter-health'

describe('AdapterHealthChecker', () => {
  it('probes Hermes with its ACP subcommand', async () => {
    const calls: Array<{ command: string; timeout: number }> = []
    const checker = new AdapterHealthChecker({
      probeTimeoutMs: 123,
      execCommand: async (command, options) => {
        calls.push({ command, timeout: options.timeout })
      },
    })

    const health = await checker.getHealth('hermes')

    expect(health.healthy).toBe(true)
    expect(calls).toEqual([{ command: 'hermes acp --help', timeout: 123 }])
  })

  it('returns a friendly missing-command reason for Hermes', async () => {
    const checker = new AdapterHealthChecker({
      execCommand: async () => {
        throw new Error('zsh: command not found: hermes')
      },
    })

    const health = await checker.getHealth('hermes')

    expect(health).toMatchObject({
      healthy: false,
      reason: 'hermes acp --help failed: command not found',
    })
  })

  it('deduplicates inflight Hermes probes and caches the result', async () => {
    let resolveProbe: (() => void) | null = null
    let probeCount = 0
    const checker = new AdapterHealthChecker({
      cacheTtlMs: 10_000,
      execCommand: async () => {
        probeCount += 1
        await new Promise<void>((resolve) => {
          resolveProbe = resolve
        })
      },
    })

    const first = checker.getHealth('hermes')
    const second = checker.getHealth('hermes')

    expect(probeCount).toBe(1)
    resolveProbe?.()
    await Promise.all([first, second])
    await checker.getHealth('hermes')

    expect(probeCount).toBe(1)
  })

  it('does not probe OpenClaw through the host CLI health checker', async () => {
    const checker = new AdapterHealthChecker({
      execCommand: async () => {
        throw new Error('unexpected probe')
      },
    })

    const health = await checker.getHealth('openclaw')

    expect(health.healthy).toBe(true)
  })
})
