/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { getBrowserosDir } from '../../lib/browseros-dir'
import { BROWSEROS_SKILL_BODY } from './browserOsSkillBody'

const CACHE_SUBDIR = ['cache', 'built-in-skills-source'] as const
const BROWSEROS_SKILL_DIR = 'browseros'

/**
 * Resolves the filesystem directory `agent-skills-manager.add()` reads
 * from when materialising the `browseros` bundle into a workspace. The
 * tool takes a directory that may contain multiple `<name>/SKILL.md`
 * bundles; we ship exactly one (`browseros/SKILL.md`).
 *
 * The source dir lives under `<browserosDir>/cache/built-in-skills-source/`
 * so it is (a) always writeable, (b) shared across every workspace so we
 * don't duplicate the source per install, and (c) obviously ephemeral — a
 * user wiping the browseros dir gets it re-materialised on the next call.
 *
 * Content-checked write: only writes when the on-disk content differs
 * from `BROWSEROS_SKILL_BODY`. A no-op re-call leaves the file's mtime
 * unchanged so downstream `agent-skills-manager.add()` sees the source
 * as unmodified and lands its own idempotent no-op path. When we tune
 * the SKILL body in code the on-disk copy still gets refreshed on the
 * next call.
 */
export async function getBundledBrowserOsSkillRoot(): Promise<string> {
  const root = join(getBrowserosDir(), ...CACHE_SUBDIR)
  const bundleDir = join(root, BROWSEROS_SKILL_DIR)
  await mkdir(bundleDir, { recursive: true })
  const skillPath = join(bundleDir, 'SKILL.md')
  const current = await readFile(skillPath, 'utf8').catch((err: unknown) => {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return null
    throw err
  })
  if (current !== BROWSEROS_SKILL_BODY) {
    await writeFile(skillPath, BROWSEROS_SKILL_BODY, 'utf8')
  }
  return root
}
