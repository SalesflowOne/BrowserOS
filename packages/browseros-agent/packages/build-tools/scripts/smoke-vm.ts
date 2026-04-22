#!/usr/bin/env bun
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { $ } from 'bun'
import { type Arch, parseArch } from './common/arch'

const INSTANCE_NAME = 'browseros-vm-smoke'
const SOCKET_POLL_INTERVAL_MS = 2000
const SOCKET_POLL_TIMEOUT_MS = 120_000

type BunRequestInit = RequestInit & { unix?: string }

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    qcow: { type: 'string' },
    arch: { type: 'string', default: 'x64' },
    limactl: { type: 'string', default: 'limactl' },
  },
})

if (!values.qcow) {
  console.error(
    'usage: smoke:vm -- --qcow <path.qcow2.zst> [--arch arm64|x64] [--limactl limactl]',
  )
  process.exit(1)
}

const arch = parseArch(values.arch ?? 'x64')

await bootAndProbe(values.qcow, arch, values.limactl ?? 'limactl')
console.log('vm smoke test passed')

async function bootAndProbe(
  qcowZstPath: string,
  arch: Arch,
  limactl: string,
): Promise<void> {
  const workDir = await mkdtemp(path.join(tmpdir(), 'browseros-vm-smoke-'))
  const qcowPath = path.join(workDir, 'disk.qcow2')
  const configPath = path.join(workDir, 'lima.yaml')
  const sockPath = path.join(workDir, 'podman.sock')

  try {
    await $`zstd -d -f -o ${qcowPath} ${qcowZstPath}`.quiet()
    await writeFile(configPath, composeLimaConfig(qcowPath, arch, sockPath))
    await $`${limactl} start --name=${INSTANCE_NAME} --tty=false ${configPath}`
    await waitForSocket(sockPath)
    await probePodmanSocket(sockPath)
  } finally {
    await $`${limactl} stop --force ${INSTANCE_NAME}`.quiet().nothrow()
    await $`${limactl} delete --force ${INSTANCE_NAME}`.quiet().nothrow()
    await rm(workDir, { recursive: true, force: true })
  }
}

function composeLimaConfig(
  qcowPath: string,
  arch: Arch,
  sockPath: string,
): string {
  return `vmType: qemu
images:
  - location: ${qcowPath}
    arch: ${limaArch(arch)}
containerd:
  system: false
  user: false
mounts: []
provision: []
portForwards:
  - guestSocket: /run/podman/podman.sock
    hostSocket: ${sockPath}
    proto: unix
`
}

function limaArch(arch: Arch): 'aarch64' | 'x86_64' {
  return arch === 'arm64' ? 'aarch64' : 'x86_64'
}

async function waitForSocket(sockPath: string): Promise<void> {
  const deadline = Date.now() + SOCKET_POLL_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (await Bun.file(sockPath).exists()) return
    await Bun.sleep(SOCKET_POLL_INTERVAL_MS)
  }
  throw new Error(
    `podman socket did not appear within ${SOCKET_POLL_TIMEOUT_MS}ms: ${sockPath}`,
  )
}

async function probePodmanSocket(sockPath: string): Promise<void> {
  const init: BunRequestInit = { unix: sockPath }
  const response = await fetch('http://d/v4.0.0/libpod/_ping', init)
  if (!response.ok) {
    throw new Error(`podman ping failed: ${response.status}`)
  }
  const body = (await response.text()).trim()
  if (body !== 'OK') {
    throw new Error(`podman ping body unexpected: ${body}`)
  }
}
