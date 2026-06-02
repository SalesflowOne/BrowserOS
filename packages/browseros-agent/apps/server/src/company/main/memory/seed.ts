// Seeds the per-employee files at hire time:
//
//   - SOUL.md           identity blurb — always regenerated so PATCH
//                       renames flow through. The agent reads this on
//                       every first reply per the protocol; leaving a
//                       stale name here means the agent introduces
//                       itself by the wrong name after a rename.
//   - MEMORY.md         zero-byte durable-facts store (write-if-missing).
//                       This is the only file the agent edits, and its
//                       writes must survive re-seeding.
//   - <agent>.md        agent-aware combined instruction file —
//                       CLAUDE.md / AGENTS.md / GEMINI.md per agentKind.
//                       Always regenerated.
//   - memory/           empty dir the agent populates lazily
//   - life/{...}/       PARA scaffolding for the agent's notes
//
// Skills are NOT seeded into the workspace — they live globally in each
// agent's own skills directory (~/.claude/skills/, ~/.codex/skills/,
// ~/.gemini/skills/) and are materialised by the boot-time ensure routine
// at `src/main/skills/ensure-built-ins.ts`.

import { access, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Employee } from '../../db/schema/employees.sql.js'
import { findHireTemplate } from '../data/employee-roles/index.js'
import {
  buildInstructionFile,
  buildSoulMd,
  instructionFilenameFor,
  MEMORY_MD_INITIAL,
} from './templates.js'

const LIFE_SUBDIRS = ['projects', 'areas', 'resources', 'archives'] as const

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function writeIfMissing(path: string, content: string): Promise<void> {
  if (await fileExists(path)) return
  await writeFile(path, content, 'utf8')
}

/**
 * Writes the per-employee files + scaffolds memory/ + life/ subdirs.
 *
 * SOUL.md and the agent-aware instruction file are regenerated on
 * every call so a PATCH on name / role / bio flows through to both
 * places the agent reads its identity from. MEMORY.md uses
 * write-if-missing because the agent edits it for durable facts —
 * those writes must survive re-seeding.
 *
 * Assumes the workspace directory itself already exists (the hire
 * route mkdirs it before calling here).
 */
export async function seedWorkspace(employee: Employee): Promise<void> {
  if (!employee.workspacePath) return
  const root = employee.workspacePath
  const template = employee.templateId
    ? findHireTemplate(employee.templateId)
    : undefined

  await writeFile(
    join(root, 'SOUL.md'),
    buildSoulMd(employee, template),
    'utf8',
  )
  await writeIfMissing(join(root, 'MEMORY.md'), MEMORY_MD_INITIAL)

  const instructionFile = instructionFilenameFor(employee.agentKind)
  await writeFile(
    join(root, instructionFile),
    buildInstructionFile(employee),
    'utf8',
  )

  await mkdir(join(root, 'memory'), { recursive: true })
  for (const sub of LIFE_SUBDIRS) {
    await mkdir(join(root, 'life', sub), { recursive: true })
  }
}
