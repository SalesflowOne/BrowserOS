#!/usr/bin/env bun

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { HeadObjectCommand, type S3Client } from '@aws-sdk/client-s3'
import {
  createR2Client,
  joinObjectKey,
  type R2Config,
  uploadFileToObject,
} from '@browseros/build-server-tools'
import { parse } from 'dotenv'

import { log } from './log'

const CDN_BASE_URL = 'https://cdn.browseros.com'
const PROD_ENV_PATH = join('apps', 'server', '.env.production')
const UPLOAD_PREFIX = 'artifacts/claw/onboarding-video'
const PACKAGE_DIR = join('packages', 'onboarding-video')
const OUT_DIR = join(PACKAGE_DIR, 'out')

const ONBOARDING_VIDEO_ASSETS = [
  {
    filename: 'first-run-demo.mp4',
    contentType: 'video/mp4',
    renderCommand: 'bun run --cwd packages/onboarding-video render',
  },
  {
    filename: 'first-run-demo-poster.png',
    contentType: 'image/png',
    renderCommand: 'bun run --cwd packages/onboarding-video render:poster',
  },
] as const

export interface OnboardingVideoUploadOptions {
  dryRun?: boolean
  force?: boolean
}

export interface OnboardingVideoAssetPlan {
  filename: string
  relativePath: string
  absolutePath: string
  contentType: string
  key: string
  url: string
  renderCommand: string
}

export interface OnboardingVideoUploadPlan {
  version: string
  assets: OnboardingVideoAssetPlan[]
}

function resolveRootDir(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '../..')
}

function readPackageVersion(rootDir: string): string {
  const packagePath = join(rootDir, PACKAGE_DIR, 'package.json')
  const pkg = JSON.parse(readFileSync(packagePath, 'utf-8')) as {
    version?: string
  }
  if (!pkg.version) {
    throw new Error(`${PACKAGE_DIR}/package.json is missing a version`)
  }
  return pkg.version
}

/** Builds the immutable R2 keys and public CDN URLs for one onboarding-video version. */
export function buildOnboardingVideoUploadPlan(
  rootDir: string,
): OnboardingVideoUploadPlan {
  const version = readPackageVersion(rootDir)
  const assets = ONBOARDING_VIDEO_ASSETS.map((asset) => {
    const relativePath = join(OUT_DIR, asset.filename)
    const key = joinObjectKey(UPLOAD_PREFIX, `v${version}`, asset.filename)
    return {
      filename: asset.filename,
      relativePath,
      absolutePath: join(rootDir, relativePath),
      contentType: asset.contentType,
      key,
      url: `${CDN_BASE_URL}/${key}`,
      renderCommand: asset.renderCommand,
    }
  })

  return { version, assets }
}

export function validateOnboardingVideoInputs(
  plan: OnboardingVideoUploadPlan,
): void {
  const missingAssets = plan.assets.filter(
    (asset) => !existsSync(asset.absolutePath),
  )
  if (missingAssets.length === 0) {
    return
  }

  const renderCommands = [
    ...new Set(missingAssets.map((asset) => asset.renderCommand)),
  ]
  throw new Error(
    [
      'Missing onboarding video render output:',
      ...missingAssets.map((asset) => `- ${asset.relativePath}`),
      '',
      'Render the missing assets first:',
      ...renderCommands.map((command) => `  ${command}`),
    ].join('\n'),
  )
}

function pickEnv(name: string, fileEnv: Record<string, string>): string {
  const value = process.env[name] ?? fileEnv[name]
  if (!value || value.trim().length === 0) {
    throw new Error(
      `Missing required environment variable: ${name} (set it in process env or ${PROD_ENV_PATH})`,
    )
  }
  return value
}

function loadProdEnv(rootDir: string): Record<string, string> {
  const prodEnvPath = join(rootDir, PROD_ENV_PATH)
  if (!existsSync(prodEnvPath)) {
    return {}
  }
  return parse(readFileSync(prodEnvPath, 'utf-8'))
}

function loadR2Config(rootDir: string): R2Config {
  const fileEnv = loadProdEnv(rootDir)
  return {
    accountId: pickEnv('R2_ACCOUNT_ID', fileEnv),
    accessKeyId: pickEnv('R2_ACCESS_KEY_ID', fileEnv),
    secretAccessKey: pickEnv('R2_SECRET_ACCESS_KEY', fileEnv),
    bucket: pickEnv('R2_BUCKET', fileEnv),
    downloadPrefix: '',
    uploadPrefix: UPLOAD_PREFIX,
  }
}

export function parseOnboardingVideoUploadArgs(
  argv: string[],
): OnboardingVideoUploadOptions {
  const options: OnboardingVideoUploadOptions = {}
  for (const arg of argv) {
    if (arg === '--') {
      continue
    }
    if (arg === '--dry-run') {
      options.dryRun = true
    } else if (arg === '--force') {
      options.force = true
    } else {
      throw new Error(`Unknown option: ${arg}`)
    }
  }
  return options
}

function isMissingObjectError(error: unknown): boolean {
  const candidate = error as {
    name?: string
    $metadata?: { httpStatusCode?: number }
  }
  return (
    candidate.name === 'NotFound' || candidate.$metadata?.httpStatusCode === 404
  )
}

async function objectExists(
  client: S3Client,
  r2: R2Config,
  key: string,
): Promise<boolean> {
  try {
    await client.send(
      new HeadObjectCommand({
        Bucket: r2.bucket,
        Key: key,
      }),
    )
    return true
  } catch (error) {
    if (isMissingObjectError(error)) {
      return false
    }
    throw error
  }
}

async function assertObjectsDoNotExist(
  client: S3Client,
  r2: R2Config,
  plan: OnboardingVideoUploadPlan,
): Promise<void> {
  const existingKeys: string[] = []
  for (const asset of plan.assets) {
    log.step(`Checking ${asset.key}`)
    if (await objectExists(client, r2, asset.key)) {
      existingKeys.push(asset.key)
    }
  }

  if (existingKeys.length > 0) {
    throw new Error(
      [
        'R2 object already exists:',
        ...existingKeys.map((key) => `- ${key}`),
        '',
        'Please bump the package version in packages/onboarding-video/package.json, or rerun with --force to overwrite intentionally.',
      ].join('\n'),
    )
  }
}

function printPlan(plan: OnboardingVideoUploadPlan): void {
  for (const asset of plan.assets) {
    log.info(asset.key)
    log.info(asset.url)
  }
}

/** Uploads the rendered first-run demo video assets to immutable R2/CDN keys. */
export async function runOnboardingVideoUpload(
  rootDir: string,
  options: OnboardingVideoUploadOptions = {},
): Promise<void> {
  const plan = buildOnboardingVideoUploadPlan(rootDir)
  validateOnboardingVideoInputs(plan)

  log.header(`BrowserClaw onboarding video v${plan.version}`)
  printPlan(plan)

  if (options.dryRun) {
    log.done('Onboarding video upload dry run completed')
    return
  }

  const r2 = loadR2Config(rootDir)
  const client = createR2Client(r2)
  try {
    if (options.force) {
      log.warn('Skipping existing-object guard because --force was supplied')
    } else {
      await assertObjectsDoNotExist(client, r2, plan)
    }

    for (const asset of plan.assets) {
      log.step(`Uploading ${asset.relativePath}`)
      await uploadFileToObject(client, r2, asset.key, asset.absolutePath, {
        contentType: asset.contentType,
      })
      log.success(`Uploaded ${asset.key}`)
      log.info(asset.url)
    }
  } finally {
    client.destroy()
  }

  log.done('Onboarding video upload completed')
}

async function main(): Promise<void> {
  const rootDir = resolveRootDir()
  const options = parseOnboardingVideoUploadArgs(process.argv.slice(2))
  await runOnboardingVideoUpload(rootDir, options)
}

if (import.meta.main) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`\n✗ ${message}\n`)
    process.exit(1)
  })
}
