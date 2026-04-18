import { readFile } from 'node:fs/promises'
import { z } from 'zod'
import {
  type CollectionTarget,
  CollectionTargetSchema,
} from '../types/collection-target'

export class TargetLoadError extends Error {
  constructor(
    message: string,
    public readonly path: string,
    public readonly cause?: Error,
  ) {
    super(message)
    this.name = 'TargetLoadError'
  }
}

export async function loadCollectionTargets(
  path: string,
): Promise<CollectionTarget[]> {
  let content: string
  try {
    content = await readFile(path, 'utf-8')
  } catch (error) {
    throw new TargetLoadError(
      `Failed to read seeds file: ${path}`,
      path,
      error instanceof Error ? error : undefined,
    )
  }

  const lines = content
    .trim()
    .split('\n')
    .filter((line) => line.trim().length > 0)

  if (lines.length === 0) {
    throw new TargetLoadError('Seeds file is empty', path)
  }

  const targets: CollectionTarget[] = []
  const errors: Array<{ line: number; error: string }> = []

  for (let i = 0; i < lines.length; i++) {
    const lineNumber = i + 1
    try {
      const parsed = JSON.parse(lines[i])
      targets.push(CollectionTargetSchema.parse(parsed))
    } catch (error) {
      if (error instanceof SyntaxError) {
        errors.push({
          line: lineNumber,
          error: `Invalid JSON: ${error.message}`,
        })
      } else if (error instanceof z.ZodError) {
        const issues = error.issues
          .map((iss) => `${iss.path.join('.')}: ${iss.message}`)
          .join(', ')
        errors.push({ line: lineNumber, error: `Validation: ${issues}` })
      } else {
        errors.push({ line: lineNumber, error: `Unknown: ${String(error)}` })
      }
    }
  }

  if (errors.length > 0) {
    const summary = errors
      .slice(0, 5)
      .map((e) => `  Line ${e.line}: ${e.error}`)
      .join('\n')
    const more =
      errors.length > 5 ? `\n  ... and ${errors.length - 5} more` : ''
    throw new TargetLoadError(
      `Failed to parse ${errors.length} target(s):\n${summary}${more}`,
      path,
    )
  }

  const seen = new Set<string>()
  const duplicates: string[] = []
  for (const t of targets) {
    if (seen.has(t.site)) duplicates.push(t.site)
    seen.add(t.site)
  }
  if (duplicates.length > 0) {
    throw new TargetLoadError(
      `Duplicate site slugs: ${duplicates.join(', ')}`,
      path,
    )
  }

  return targets
}
