/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Host-side path helpers for the Hermes container.
 *
 * Hermes per-agent state lives under the BrowserOS-managed VM state
 * directory (so it's reachable inside the Lima VM via the existing
 * vm/ → /mnt/browseros/vm bind mount). The Hermes container then bind-
 * mounts the guest-side path (/mnt/browseros/vm/hermes/harness) into
 * /data/agents/harness, so `HERMES_HOME` ends up pointing at a path
 * the container can actually open.
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { getVmStateDir } from '../../../lib/browseros-dir'

/** Top-level Hermes state directory: `<browserosDir>/vm/hermes`. */
export function getHermesHostStateDir(browserosDir?: string): string {
  return join(
    browserosDir ? join(browserosDir, 'vm') : getVmStateDir(),
    'hermes',
  )
}

/** Per-agent harness root: `<browserosDir>/vm/hermes/harness`. */
export function getHermesHarnessHostDir(browserosDir?: string): string {
  return join(getHermesHostStateDir(browserosDir), 'harness')
}

/**
 * Per-agent home directory on the host. Stays parallel to the
 * Claude/Codex layout so prepare.ts can seed config.yaml/.env/auth.json
 * here before the container reads them via the bind mount.
 */
export function getHermesAgentHomeHostDir(input: {
  browserosDir?: string
  agentId: string
}): string {
  return join(
    getHermesHarnessHostDir(input.browserosDir),
    input.agentId,
    'home',
  )
}

/**
 * Write a Hermes per-agent provider config into the on-host home dir.
 * The dir lives under <browserosDir>/vm/hermes/harness/<agentId>/home/
 * which is bind-mounted into the container at /data/agents/harness/<id>/home/.
 *
 * Idempotent: writes always overwrite (last-write-wins).
 *
 * `~/.hermes/` global config is unrelated and untouched. The
 * seedHermesHomeFromGlobal helper in prepare.ts only copies from global
 * if the per-agent files DON'T already exist — so once this helper
 * has written per-agent config.yaml/.env, the global seed becomes a
 * no-op for that agent.
 */
export async function writeHermesPerAgentProvider(input: {
  browserosDir?: string
  agentId: string
  providerId: string
  envVarName: string
  apiKey: string
  modelId: string
  baseUrl?: string
}): Promise<void> {
  const home = getHermesAgentHomeHostDir({
    browserosDir: input.browserosDir,
    agentId: input.agentId,
  })
  await mkdir(home, { recursive: true })

  const yamlLines = [
    'model:',
    `  default: ${JSON.stringify(input.modelId)}`,
    `  provider: ${JSON.stringify(input.providerId)}`,
  ]
  if (input.baseUrl) {
    yamlLines.push(`  base_url: ${JSON.stringify(input.baseUrl)}`)
  }
  yamlLines.push('')
  await writeFile(join(home, 'config.yaml'), yamlLines.join('\n'), {
    mode: 0o600,
  })

  const envLines: string[] = [`${input.envVarName}=${input.apiKey}`, '']
  await writeFile(join(home, '.env'), envLines.join('\n'), { mode: 0o600 })
}
