/**
 * @license
 * Copyright 2025 BrowserOS
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { PodmanShell } from '../../../src/lib/podman/podman-shell'
import { PodmanCommandError } from '../../../src/lib/vm/errors'
import { fakeLimactl } from '../../__helpers__/fake-limactl'

describe('PodmanShell', () => {
  let tempDir: string
  let logPath: string

  beforeEach(async () => {
    tempDir = await mkdtemp('/tmp/podman-shell-')
    logPath = join(tempDir, 'limactl.log')
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('checks image existence with podman image inspect', async () => {
    const limactlPath = await fakeLimactl({ shell: {} }, logPath)
    const shell = createShell(limactlPath, tempDir)

    await expect(shell.imageExists('openclaw:v1')).resolves.toBe(true)

    await expect(readFile(logPath, 'utf8')).resolves.toContain(
      'ARGS:shell browseros-vm -- podman image inspect openclaw:v1',
    )
    await expect(readFile(logPath, 'utf8')).resolves.toContain(
      `LIMA_HOME:${tempDir}/lima`,
    )
  })

  it('returns false when image inspect exits non-zero', async () => {
    const limactlPath = await fakeLimactl(
      { shell: { stderr: 'missing', exit: 1 } },
      logPath,
    )
    const shell = createShell(limactlPath, tempDir)

    await expect(shell.imageExists('openclaw:v1')).resolves.toBe(false)
  })

  it('pulls images with progress and throws typed command errors', async () => {
    const limactlPath = await fakeLimactl(
      { shell: { stdout: 'pulling\n', stderr: 'denied', exit: 2 } },
      logPath,
    )
    const shell = createShell(limactlPath, tempDir)
    const lines: string[] = []

    const error = await shell
      .pullImage('openclaw:v1', (line) => lines.push(line))
      .catch((err) => err)

    expect(error).toBeInstanceOf(PodmanCommandError)
    expect(error.exitCode).toBe(2)
    expect(error.stderr).toBe('denied')
    expect(lines).toContain('pulling')
    expect(lines).toContain('denied')
  })

  it('loads images from guest tarballs and returns loaded refs', async () => {
    const limactlPath = await fakeLimactl(
      { shell: { stdout: 'Loaded image: openclaw:v1\n' } },
      logPath,
    )
    const shell = createShell(limactlPath, tempDir)

    await expect(
      shell.loadImage('/mnt/browseros/cache/images/openclaw.tar.gz'),
    ).resolves.toEqual(['openclaw:v1'])
    await expect(readFile(logPath, 'utf8')).resolves.toContain(
      'ARGS:shell browseros-vm -- podman load -i /mnt/browseros/cache/images/openclaw.tar.gz',
    )
  })

  it('creates containers from typed specs', async () => {
    const limactlPath = await fakeLimactl({ shell: {} }, logPath)
    const shell = createShell(limactlPath, tempDir)

    await shell.createContainer({
      name: 'gateway',
      image: 'openclaw:v1',
      restart: 'unless-stopped',
      ports: [{ hostIp: '127.0.0.1', hostPort: 18789, containerPort: 18789 }],
      envFile: '/mnt/browseros/vm/openclaw/.env',
      env: { HOME: '/home/node', NODE_ENV: 'production' },
      mounts: [
        {
          source: '/mnt/browseros/vm/openclaw',
          target: '/home/node',
          readonly: true,
        },
      ],
      addHosts: ['host.containers.internal:host-gateway'],
      health: {
        cmd: 'curl -sf http://127.0.0.1:18789/healthz',
        interval: '30s',
        timeout: '10s',
        retries: 3,
      },
      command: ['node', 'dist/index.js', 'gateway'],
    })

    await expect(readFile(logPath, 'utf8')).resolves.toContain(
      [
        'ARGS:shell browseros-vm -- podman create',
        '--name gateway',
        '--restart unless-stopped',
        '-p 127.0.0.1:18789:18789',
        '--env-file /mnt/browseros/vm/openclaw/.env',
        '-e HOME=/home/node',
        '-e NODE_ENV=production',
        '-v /mnt/browseros/vm/openclaw:/home/node:ro',
        '--add-host host.containers.internal:host-gateway',
        '--health-cmd curl -sf http://127.0.0.1:18789/healthz',
        '--health-interval 30s',
        '--health-timeout 10s',
        '--health-retries 3',
        'openclaw:v1 node dist/index.js gateway',
      ].join(' '),
    )
  })

  it('starts, stops, removes, execs, and lists containers', async () => {
    const limactlPath = await fakeLimactl(
      { shell: { stdout: 'gateway\nworker\n' } },
      logPath,
    )
    const shell = createShell(limactlPath, tempDir)

    await shell.startContainer('gateway')
    await shell.stopContainer('gateway')
    await shell.removeContainer('gateway', { force: true })
    await expect(shell.exec('gateway', ['node', '--version'])).resolves.toBe(0)
    await expect(shell.ps({ namesOnly: true })).resolves.toEqual([
      'gateway',
      'worker',
    ])

    const log = await readFile(logPath, 'utf8')
    expect(log).toContain('ARGS:shell browseros-vm -- podman start gateway')
    expect(log).toContain('ARGS:shell browseros-vm -- podman stop gateway')
    expect(log).toContain(
      'ARGS:shell browseros-vm -- podman rm -f --ignore gateway',
    )
    expect(log).toContain(
      'ARGS:shell browseros-vm -- podman exec gateway node --version',
    )
    expect(log).toContain(
      'ARGS:shell browseros-vm -- podman ps --format {{.Names}}',
    )
  })

  it('tolerates stop when the container is already absent', async () => {
    const limactlPath = await fakeLimactl(
      { shell: { stderr: 'no such container', exit: 1 } },
      logPath,
    )
    const shell = createShell(limactlPath, tempDir)

    await expect(shell.stopContainer('gateway')).resolves.toBeUndefined()
  })

  it('tails logs and returns a stop handle', async () => {
    const limactlPath = await fakeLimactl(
      { shell: { stdout: 'line\n' } },
      logPath,
    )
    const shell = createShell(limactlPath, tempDir)
    const lines: string[] = []

    const stop = shell.tailLogs('gateway', (line) => lines.push(line))
    await Bun.sleep(20)
    stop()

    expect(lines).toEqual(['line'])
    await expect(readFile(logPath, 'utf8')).resolves.toContain(
      'ARGS:shell browseros-vm -- podman logs -f --tail 0 gateway',
    )
  })
})

function createShell(limactlPath: string, tempDir: string): PodmanShell {
  return new PodmanShell({
    limactlPath,
    limaHome: join(tempDir, 'lima'),
    vmName: 'browseros-vm',
  })
}
