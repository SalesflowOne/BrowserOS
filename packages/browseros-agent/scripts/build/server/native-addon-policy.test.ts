import { afterEach, describe, expect, it } from 'bun:test'
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { SERVER_BUNDLE_ENTRYPOINT } from './descriptor'

const nativeAddonGuardPath = join(
  process.cwd(),
  'apps/server/src/lib/native-addon-guard.ts',
)
const nativeAddonGuardMessage =
  'BrowserOS server disables native addon loading in compiled production builds'

describe('compiled server native addon policy', () => {
  let tempDir: string | null = null

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true })
      tempDir = null
    }
  })

  it('bundles the compiled bootstrap entrypoint', () => {
    expect(SERVER_BUNDLE_ENTRYPOINT).toBe(
      'apps/server/src/compiled-bootstrap.ts',
    )
  })

  it('installs the native-addon guard idempotently', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'browseros-native-addon-policy-'))
    const sourcePath = join(tempDir, 'idempotent.ts')
    await writeFile(
      sourcePath,
      [
        `import { installNativeAddonGuard } from ${JSON.stringify(nativeAddonGuardPath)}`,
        'installNativeAddonGuard()',
        'const guarded = process.dlopen',
        'installNativeAddonGuard()',
        'console.log(String(process.dlopen === guarded))',
      ].join('\n'),
    )

    const result = await collectProcess(
      Bun.spawn(['bun', sourcePath], {
        stdout: 'pipe',
        stderr: 'pipe',
      }),
    )

    expect(result).toMatchObject({ exitCode: 0, stdout: 'true\n' })
  })

  it('prevents Bun from opening hidden temp native addons', async () => {
    if (process.platform !== 'darwin') return

    tempDir = await mkdtemp(join(tmpdir(), 'browseros-native-addon-policy-'))
    const sourcePath = join(tempDir, 'app.js')
    const addonPath = join(tempDir, 'addon.node')
    const binaryPath = join(tempDir, 'app')
    const runTmpDir = join(tempDir, 'tmp')

    await writeFile(addonPath, 'not a native addon')
    await writeFile(
      sourcePath,
      [
        `import { installNativeAddonGuard } from ${JSON.stringify(nativeAddonGuardPath)}`,
        'installNativeAddonGuard()',
        'try {',
        '  require("./addon.node")',
        '} catch (error) {',
        '  console.error(error?.message ?? String(error))',
        '  setInterval(() => {}, 1000)',
        '}',
      ].join('\n'),
    )

    const build = Bun.spawn(
      ['bun', 'build', '--compile', sourcePath, '--outfile', binaryPath],
      {
        stdout: 'pipe',
        stderr: 'pipe',
      },
    )
    const buildResult = await collectProcess(build)
    expect(buildResult).toMatchObject({ exitCode: 0 })

    await rm(sourcePath)
    await rm(addonPath)
    await mkdir(runTmpDir)

    const app = Bun.spawn([binaryPath], {
      env: {
        ...process.env,
        BUN_TMPDIR: runTmpDir,
        TMPDIR: runTmpDir,
      },
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const stdout = collectTextStream(app.stdout)
    const stderr = collectTextStream(app.stderr)

    await waitForStreamText(stderr, nativeAddonGuardMessage)

    const openFiles = await collectProcess(
      Bun.spawn(['lsof', '-p', String(app.pid)], {
        stdout: 'pipe',
        stderr: 'pipe',
      }),
    )

    app.kill()
    const [stdoutText, stderrText, exitCode] = await Promise.all([
      stdout.complete,
      stderr.complete,
      app.exited,
    ])
    const appResult = { exitCode, stdout: stdoutText, stderr: stderrText }

    expect(appResult.stderr).toContain(nativeAddonGuardMessage)
    expect(await listFiles(runTmpDir)).toEqual([])
    expect(openFiles.stdout).not.toContain('.node')
  })
})

interface CollectableProcess {
  stdout: ReadableStream
  stderr: ReadableStream
  exited: Promise<number>
}

async function collectProcess(process: CollectableProcess) {
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ])

  return { stdout, stderr, exitCode }
}

interface TextStreamCollector {
  complete: Promise<string>
  snapshot: () => string
}

function collectTextStream(stream: ReadableStream): TextStreamCollector {
  const decoder = new TextDecoder()
  let text = ''
  const complete = (async () => {
    const reader = stream.getReader()
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        text +=
          typeof value === 'string'
            ? value
            : decoder.decode(value, { stream: true })
      }
      text += decoder.decode()
    } finally {
      reader.releaseLock()
    }

    return text
  })()

  return { complete, snapshot: () => text }
}

async function waitForStreamText(
  collector: TextStreamCollector,
  text: string,
  timeoutMs = 5000,
) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    if (collector.snapshot().includes(text)) return
    await Bun.sleep(50)
  }

  throw new Error(
    `Timed out waiting for process output to include ${JSON.stringify(
      text,
    )}. Current output: ${JSON.stringify(collector.snapshot())}`,
  )
}

async function listFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true })
  return entries.map(String).sort()
}
