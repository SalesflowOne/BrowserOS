import { readdir, readFile, writeFile } from 'node:fs/promises'
import { extname, join, relative } from 'node:path'
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import type { ShowcaseRunIndex, ShowcaseTaskManifest } from './types'

interface R2Config {
  accountId: string
  accessKeyId: string
  secretAccessKey: string
  bucket: string
}

function contentTypeFor(filePath: string): string {
  const ext = extname(filePath).toLowerCase()
  if (ext === '.png') return 'image/png'
  if (ext === '.json') return 'application/json'
  if (ext === '.jsonl') return 'application/jsonl'
  return 'application/octet-stream'
}

function loadR2Config(): R2Config {
  const accountId = process.env.R2_ACCOUNT_ID
  const accessKeyId = process.env.R2_ACCESS_KEY_ID
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY
  const bucket = process.env.R2_BUCKET ?? 'rl-env'

  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error(
      'Missing R2 credentials. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY',
    )
  }

  return { accountId, accessKeyId, secretAccessKey, bucket }
}

function toR2Key(prefix: string, outputDir: string, filePath: string): string {
  return `${prefix}/${relative(outputDir, filePath).replaceAll('\\', '/')}`
}

async function walkDir(dir: string): Promise<string[]> {
  const files: string[] = []
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await walkDir(fullPath)))
    } else {
      files.push(fullPath)
    }
  }
  return files
}

export async function uploadShowcase(
  outputDir: string,
  runId: string,
): Promise<string> {
  const r2 = loadR2Config()
  const client = new S3Client({
    region: 'auto',
    endpoint: `https://${r2.accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: r2.accessKeyId,
      secretAccessKey: r2.secretAccessKey,
    },
  })

  const prefix = `showcase/${runId}`
  const files = await walkDir(outputDir)
  console.log(
    `Uploading ${files.length} files to R2 (${r2.bucket}/${prefix})...`,
  )

  for (const filePath of files) {
    const key = toR2Key(prefix, outputDir, filePath)
    const data = await readFile(filePath)
    await client.send(
      new PutObjectCommand({
        Bucket: r2.bucket,
        Key: key,
        Body: data,
        ContentType: contentTypeFor(filePath),
      }),
    )
  }

  const baseUrl = `https://${r2.bucket}.${r2.accountId}.r2.cloudflarestorage.com/${prefix}`
  console.log(`Upload complete. Base: ${baseUrl}`)

  // Stamp uploadedAt on index.json
  const indexPath = join(outputDir, 'index.json')
  try {
    const indexData = JSON.parse(
      await readFile(indexPath, 'utf-8'),
    ) as ShowcaseRunIndex
    indexData.uploadedAt = new Date().toISOString()
    await writeFile(indexPath, JSON.stringify(indexData, null, 2))
  } catch {
    // index may not exist if run was partial
  }

  // Stamp uploadedAt on each task manifest
  for (const file of files) {
    if (file.endsWith('manifest.json') && file !== indexPath) {
      try {
        const manifestData = JSON.parse(
          await readFile(file, 'utf-8'),
        ) as ShowcaseTaskManifest
        manifestData.uploadedAt = new Date().toISOString()
        // Rewrite screenshot paths to R2 keys
        for (const step of manifestData.steps) {
          step.beforeScreenshot = toR2Key(
            prefix,
            outputDir,
            step.beforeScreenshot,
          )
          step.afterScreenshot = toR2Key(
            prefix,
            outputDir,
            step.afterScreenshot,
          )
          if (step.annotatedScreenshot) {
            step.annotatedScreenshot = toR2Key(
              prefix,
              outputDir,
              step.annotatedScreenshot,
            )
          }
        }
        await writeFile(file, JSON.stringify(manifestData, null, 2))
      } catch {
        // skip malformed manifests
      }
    }
  }

  // Re-upload rewritten manifests + index
  const jsonFiles = files.filter(
    (f) => f.endsWith('.json') && !f.includes('node_modules'),
  )
  for (const filePath of jsonFiles) {
    const key = toR2Key(prefix, outputDir, filePath)
    const data = await readFile(filePath)
    await client.send(
      new PutObjectCommand({
        Bucket: r2.bucket,
        Key: key,
        Body: data,
        ContentType: 'application/json',
      }),
    )
  }

  return baseUrl
}
