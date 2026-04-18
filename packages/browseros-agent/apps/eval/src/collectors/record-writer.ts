import { randomUUID } from 'node:crypto'
import { access, mkdir, writeFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import type { CollectedRecord } from '../types/collection-target'

export interface PreparedRecord
  extends Omit<CollectedRecord, 'id' | 'screenshot_path'> {}

export interface WriteResult {
  id: string
  screenshotPath: string
  jsonPath: string
  skipped: boolean
}

export class RecordWriter {
  private readonly siteCounts = new Map<string, number>()

  constructor(
    private readonly outDir: string,
    private readonly projectRoot: string,
  ) {}

  async init(): Promise<void> {
    await mkdir(join(this.outDir, 'screenshots'), { recursive: true })
    await mkdir(join(this.outDir, 'raw'), { recursive: true })
  }

  async write(record: PreparedRecord, pngBase64: string): Promise<WriteResult> {
    const shortUuid = randomUUID().replace(/-/g, '').slice(0, 8)
    const id = `${record.site}_${shortUuid}`

    const pngPath = join(this.outDir, 'screenshots', `${id}.png`)
    const jsonPath = join(this.outDir, 'raw', `${id}.json`)

    if ((await exists(pngPath)) && (await exists(jsonPath))) {
      return { id, screenshotPath: pngPath, jsonPath, skipped: true }
    }

    await writeFile(pngPath, Buffer.from(pngBase64, 'base64'))

    const screenshotRelPath = relative(this.projectRoot, pngPath)
    const finalRecord: CollectedRecord = {
      ...record,
      id,
      screenshot_path: screenshotRelPath,
    }
    await writeFile(jsonPath, `${JSON.stringify(finalRecord, null, 2)}\n`)

    this.siteCounts.set(
      record.site,
      (this.siteCounts.get(record.site) ?? 0) + 1,
    )
    return { id, screenshotPath: pngPath, jsonPath, skipped: false }
  }

  async writeManifest(collectedAt: Date, collectorTag: string): Promise<void> {
    const sites = [...this.siteCounts.entries()].map(([site, states]) => ({
      site,
      states,
    }))
    const manifest = {
      collected_at: collectedAt.toISOString(),
      collector: collectorTag,
      total_records: [...this.siteCounts.values()].reduce((a, b) => a + b, 0),
      sites,
      viewport: { width: 1280, height: 800 },
    }
    await writeFile(
      join(this.outDir, 'meta.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
    )
  }

  getSiteCounts(): Map<string, number> {
    return new Map(this.siteCounts)
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}
