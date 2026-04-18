import { access, readdir, readFile } from 'node:fs/promises'
import { basename, extname, isAbsolute, join, resolve } from 'node:path'
import {
  type CollectedRecord,
  CollectedRecordSchema,
} from '../types/collection-target'

export async function validateOutput(
  outDir: string,
  projectRoot: string = process.cwd(),
): Promise<string[]> {
  const errors: string[] = []
  const rawDir = join(outDir, 'raw')

  let files: string[]
  try {
    files = await readdir(rawDir)
  } catch {
    return [`${rawDir}: directory not readable`]
  }
  const jsonFiles = files.filter((n) => n.endsWith('.json'))
  if (jsonFiles.length === 0) return [`${rawDir}: no .json records`]

  for (const f of jsonFiles) {
    const fileErrors = await validateRecordFile(rawDir, f, projectRoot)
    errors.push(...fileErrors)
  }
  return errors
}

async function validateRecordFile(
  rawDir: string,
  filename: string,
  projectRoot: string,
): Promise<string[]> {
  const errors: string[] = []
  const fullPath = join(rawDir, filename)

  let raw: string
  try {
    raw = await readFile(fullPath, 'utf-8')
  } catch (e) {
    return [`${filename}: cannot read: ${stringErr(e)}`]
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (e) {
    return [`${filename}: invalid JSON: ${stringErr(e)}`]
  }

  const result = CollectedRecordSchema.safeParse(parsed)
  if (!result.success) {
    return [`${filename}: schema: ${result.error.message}`]
  }
  const record = result.data

  if (record.id !== basename(filename, extname(filename))) {
    errors.push(`${filename}: id "${record.id}" does not match filename stem`)
  }

  const lineCount = record.snapshot.split('\n').length
  if (lineCount !== record.elements.length) {
    errors.push(
      `${filename}: snapshot has ${lineCount} lines but elements has ${record.elements.length}`,
    )
  }

  errors.push(...validateElements(filename, record))
  errors.push(
    ...(await validateScreenshotExists(filename, record, projectRoot)),
  )
  return errors
}

function validateElements(filename: string, record: CollectedRecord): string[] {
  const errors: string[] = []
  const seen = new Set<number>()
  for (const el of record.elements) {
    if (seen.has(el.backend_id)) {
      errors.push(`${filename}: duplicate backend_id ${el.backend_id}`)
    }
    seen.add(el.backend_id)
    if (el.bbox[0] > el.bbox[2] || el.bbox[1] > el.bbox[3]) {
      errors.push(
        `${filename}: backend_id ${el.backend_id} has bad bbox ${JSON.stringify(el.bbox)}`,
      )
    }
    if (!el.snapshot_line.startsWith(`[${el.backend_id}]`)) {
      errors.push(
        `${filename}: backend_id ${el.backend_id} snapshot_line does not start with [${el.backend_id}]`,
      )
    }
    if (!record.snapshot.includes(el.snapshot_line)) {
      errors.push(
        `${filename}: snapshot_line for [${el.backend_id}] not found in snapshot`,
      )
    }
  }
  return errors
}

async function validateScreenshotExists(
  filename: string,
  record: CollectedRecord,
  projectRoot: string,
): Promise<string[]> {
  const screenshotPath = isAbsolute(record.screenshot_path)
    ? record.screenshot_path
    : resolve(projectRoot, record.screenshot_path)
  try {
    await access(screenshotPath)
    return []
  } catch {
    return [`${filename}: screenshot_path missing on disk (${screenshotPath})`]
  }
}

function stringErr(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}
