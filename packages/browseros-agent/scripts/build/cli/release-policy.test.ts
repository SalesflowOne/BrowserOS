import { describe, expect, test } from 'bun:test'

import {
  assertIncrementingRelease,
  compareReleaseVersions,
  parseCliReleaseTag,
  selectPreviousCliReleaseTag,
} from './release-policy'

describe('parseCliReleaseTag', () => {
  test('parses cli release tags', () => {
    expect(parseCliReleaseTag('cli/v0.2.3')).toEqual({
      tag: 'cli/v0.2.3',
      version: '0.2.3',
    })
  })

  test('rejects non-cli and non-strict tags', () => {
    for (const tag of [
      'browseros-cli-v0.2.3',
      'cli/0.2.3',
      'cli/v0.2',
      'cli/v0.2.3-rc1',
      'server/v0.2.3',
    ]) {
      expect(() => parseCliReleaseTag(tag)).toThrow('cli/vX.Y.Z')
    }
  })
})

describe('compareReleaseVersions', () => {
  test('orders strict release versions', () => {
    expect(compareReleaseVersions('0.2.3', '0.2.2')).toBe(1)
    expect(compareReleaseVersions('0.2.2', '0.2.2')).toBe(0)
    expect(compareReleaseVersions('0.2.1', '0.2.2')).toBe(-1)
    expect(compareReleaseVersions('1.0.0', '0.9.9')).toBe(1)
  })

  test('rejects loose or prerelease versions', () => {
    expect(() => compareReleaseVersions('v0.2.3', '0.2.2')).toThrow(
      'strict release version',
    )
    expect(() => compareReleaseVersions('0.2.3-rc1', '0.2.2')).toThrow(
      'strict release version',
    )
  })
})

describe('assertIncrementingRelease', () => {
  test('allows releases newer than production latest', () => {
    expect(() => assertIncrementingRelease('0.2.3', '0.2.2')).not.toThrow()
  })

  test('rejects equal or lower releases', () => {
    expect(() => assertIncrementingRelease('0.2.2', '0.2.2')).toThrow(
      'must be greater',
    )
    expect(() => assertIncrementingRelease('0.2.1', '0.2.2')).toThrow(
      'must be greater',
    )
  })
})

describe('selectPreviousCliReleaseTag', () => {
  test('selects the latest earlier tag across new and legacy CLI tags', () => {
    expect(
      selectPreviousCliReleaseTag(
        [
          'browseros-cli-v0.2.0',
          'browseros-cli-v0.2.2',
          'cli/v0.0.1',
          'browseros-cli-v0.1.0-rc1',
          'agent-extension-v1.0.0',
        ],
        '0.2.3',
      ),
    ).toBe('browseros-cli-v0.2.2')
  })

  test('prefers new cli tags when versions tie', () => {
    expect(
      selectPreviousCliReleaseTag(
        ['browseros-cli-v0.2.2', 'cli/v0.2.2'],
        '0.2.3',
      ),
    ).toBe('cli/v0.2.2')
  })

  test('returns empty string when there is no previous CLI release tag', () => {
    expect(
      selectPreviousCliReleaseTag(['agent-extension-v1.0.0'], '0.2.3'),
    ).toBe('')
  })
})
