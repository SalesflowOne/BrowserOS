import { describe, expect, test } from 'bun:test'
import {
  composeVirtCustomizeArgv,
  parsePackagesOutput,
  parseRecipe,
} from '../src/build/recipe'

describe('parseRecipe', () => {
  test('skips comments and blank lines, parses all four ops', () => {
    const text = `
# comment
run-command apt-get update

copy-in auth.json:/etc/containers/
write /etc/browseros-vm-version:{version}
truncate /etc/machine-id
`
    expect(parseRecipe(text)).toEqual([
      { op: 'run-command', cmd: 'apt-get update' },
      { op: 'copy-in', src: 'auth.json', dest: '/etc/containers/' },
      { op: 'write', dest: '/etc/browseros-vm-version', content: '{version}' },
      { op: 'truncate', target: '/etc/machine-id' },
    ])
  })

  test('rejects unknown ops', () => {
    expect(() => parseRecipe('unknown-op something')).toThrow(
      /unknown recipe op/,
    )
  })

  test('write with colon in content keeps everything after first colon', () => {
    expect(parseRecipe('write /etc/x:a:b:c')).toEqual([
      { op: 'write', dest: '/etc/x', content: 'a:b:c' },
    ])
  })
})

describe('composeVirtCustomizeArgv', () => {
  test('substitutes variables and resolves copy-in relative to recipeDir', () => {
    const argv = composeVirtCustomizeArgv({
      diskPath: '/work/disk.qcow2',
      recipe: [
        { op: 'run-command', cmd: 'echo {version}' },
        { op: 'copy-in', src: 'auth.json', dest: '/etc/' },
        { op: 'write', dest: '/etc/version', content: '{version}' },
        { op: 'truncate', target: '/etc/machine-id' },
      ],
      substitutions: { version: '2026.04.22-1' },
      recipeDir: '/recipe',
    })
    expect(argv).toEqual([
      '-a',
      '/work/disk.qcow2',
      '--run-command',
      'echo 2026.04.22-1',
      '--copy-in',
      '/recipe/auth.json:/etc/',
      '--write',
      '/etc/version:2026.04.22-1',
      '--truncate',
      '/etc/machine-id',
      '--run-command',
      // biome-ignore lint/suspicious/noTemplateCurlyInString: dpkg format placeholder, not JS template
      "dpkg-query -W -f='${Package} ${Version}\\n' > /var/lib/browseros-vm-pkg-versions",
    ])
  })

  test('absolute copy-in paths are passed through', () => {
    const argv = composeVirtCustomizeArgv({
      diskPath: '/disk.qcow2',
      recipe: [
        { op: 'copy-in', src: '/tmp/manifest.json', dest: '/etc/m.json' },
      ],
      substitutions: {},
      recipeDir: '/recipe',
    })
    expect(argv).toContain('--copy-in')
    expect(argv).toContain('/tmp/manifest.json:/etc/m.json')
  })

  test('copy-in resolves absolutes from substituted placeholders', () => {
    const argv = composeVirtCustomizeArgv({
      diskPath: '/disk.qcow2',
      recipe: [{ op: 'copy-in', src: '{manifest_tmp}', dest: '/etc/m.json' }],
      substitutions: { manifest_tmp: '/tmp/vm-dist/manifest-stub.json' },
      recipeDir: '/recipe',
    })
    expect(argv).toContain('/tmp/vm-dist/manifest-stub.json:/etc/m.json')
    expect(argv.join(' ')).not.toContain('/recipe/tmp/')
  })

  test('unresolved substitutions pass through unchanged', () => {
    const argv = composeVirtCustomizeArgv({
      diskPath: '/disk.qcow2',
      recipe: [
        { op: 'run-command', cmd: 'echo {missing}' },
        { op: 'write', dest: '/etc/x', content: '{also_missing}' },
      ],
      substitutions: { version: '2026.04.22-1' },
      recipeDir: '/recipe',
    })
    expect(argv).toContain('echo {missing}')
    expect(argv).toContain('/etc/x:{also_missing}')
  })
})

describe('parsePackagesOutput', () => {
  test('parses dpkg-query output', () => {
    const text = `podman 4.3.1+ds1-8+deb12u1
crun 1.8.1-1+deb12u1

fuse-overlayfs 1.10-1+b1
`
    expect(parsePackagesOutput(text)).toEqual({
      podman: '4.3.1+ds1-8+deb12u1',
      crun: '1.8.1-1+deb12u1',
      'fuse-overlayfs': '1.10-1+b1',
    })
  })
})
