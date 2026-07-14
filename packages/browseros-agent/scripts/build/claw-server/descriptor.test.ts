import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { loadBuildConfig } from '@browseros/build-server-tools'

import { clawServerBuildProduct } from './descriptor'

describe('claw server build descriptor', () => {
  let tempRoot: string | null = null
  let originalNodeEnv: string | undefined
  let originalPosthogKey: string | undefined
  let originalPosthogHost: string | undefined

  beforeEach(() => {
    originalNodeEnv = process.env.NODE_ENV
    originalPosthogKey = process.env.CLAW_POSTHOG_KEY
    originalPosthogHost = process.env.CLAW_POSTHOG_HOST
    delete process.env.NODE_ENV
    delete process.env.CLAW_POSTHOG_KEY
    delete process.env.CLAW_POSTHOG_HOST
  })

  afterEach(async () => {
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV
    } else {
      process.env.NODE_ENV = originalNodeEnv
    }
    if (originalPosthogKey === undefined) {
      delete process.env.CLAW_POSTHOG_KEY
    } else {
      process.env.CLAW_POSTHOG_KEY = originalPosthogKey
    }
    if (originalPosthogHost === undefined) {
      delete process.env.CLAW_POSTHOG_HOST
    } else {
      process.env.CLAW_POSTHOG_HOST = originalPosthogHost
    }

    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true })
      tempRoot = null
    }
  })

  it('inlines NODE_ENV from the production env file', async () => {
    const rootDir = await writeClawPackageRoot(
      'NODE_ENV=production\nCLAW_POSTHOG_KEY=phc_claw_test\n',
    )

    const config = loadBuildConfig(rootDir, clawServerBuildProduct)

    expect(config.envVars.NODE_ENV).toBe('production')
  })

  it('defaults CI builds to production NODE_ENV without an env file', async () => {
    const rootDir = await writeClawPackageRoot()

    const config = loadBuildConfig(rootDir, clawServerBuildProduct, {
      ci: true,
    })

    expect(config.envVars.NODE_ENV).toBe('production')
  })

  it('forces CI builds to production NODE_ENV over ambient env', async () => {
    process.env.NODE_ENV = 'development'
    const rootDir = await writeClawPackageRoot()

    const config = loadBuildConfig(rootDir, clawServerBuildProduct, {
      ci: true,
    })

    expect(config.envVars.NODE_ENV).toBe('production')
  })

  it('inlines required key and optional host from the production env', async () => {
    const rootDir = await writeClawPackageRoot(
      [
        'CLAW_POSTHOG_KEY=phc_claw_test',
        'CLAW_POSTHOG_HOST=https://eu.i.posthog.com',
      ].join('\n'),
    )

    const config = loadBuildConfig(rootDir, clawServerBuildProduct)

    expect(config.envVars.CLAW_POSTHOG_KEY).toBe('phc_claw_test')
    expect(config.envVars.CLAW_POSTHOG_HOST).toBe('https://eu.i.posthog.com')
  })

  it('requires the Claw PostHog key for production builds', async () => {
    const rootDir = await writeClawPackageRoot('NODE_ENV=production\n')

    expect(() => loadBuildConfig(rootDir, clawServerBuildProduct)).toThrow(
      'BrowserOS Claw server: Missing required env: CLAW_POSTHOG_KEY (section: claw)',
    )
  })

  it('keeps CI fixture builds keyless and the host optional', async () => {
    const rootDir = await writeClawPackageRoot()

    const config = loadBuildConfig(rootDir, clawServerBuildProduct, {
      ci: true,
    })

    expect(clawServerBuildProduct.env.requiredInlineEnvKeys).toContain(
      'CLAW_POSTHOG_KEY',
    )
    expect(config.envVars.CLAW_POSTHOG_KEY).toBeUndefined()
    expect(config.envVars.CLAW_POSTHOG_HOST).toBeUndefined()
  })

  async function writeClawPackageRoot(envContent?: string): Promise<string> {
    tempRoot = await mkdtemp(join(tmpdir(), 'claw-server-build-descriptor-'))
    const packageDir = join(tempRoot, 'apps/claw-server')
    await mkdir(packageDir, { recursive: true })
    await writeFile(
      join(packageDir, 'package.json'),
      '{"version":"0.0.0-test"}',
    )
    if (envContent !== undefined) {
      await writeFile(join(tempRoot, '.env.production'), envContent)
    }
    return tempRoot
  }
})
