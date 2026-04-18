import { describe, expect, it } from 'bun:test'
import {
  parseSnapshot,
  SnapshotParseError,
} from '../../src/collectors/snapshot-parser'

describe('parseSnapshot', () => {
  it('parses a simple button line with name', () => {
    const result = parseSnapshot('[337] button "Search"')
    expect(result).toEqual([
      {
        backend_id: 337,
        role: 'button',
        name: 'Search',
        snapshot_line: '[337] button "Search"',
      },
    ])
  })

  it('parses an empty-name element (searchbox with no accessible name)', () => {
    const result = parseSnapshot('[22] searchbox ""')
    expect(result[0]).toEqual({
      backend_id: 22,
      role: 'searchbox',
      name: '',
      snapshot_line: '[22] searchbox ""',
    })
  })

  it('parses an element with no name at all', () => {
    const result = parseSnapshot('[5] checkbox')
    expect(result[0]).toEqual({
      backend_id: 5,
      role: 'checkbox',
      name: '',
      snapshot_line: '[5] checkbox',
    })
  })

  it('parses a searchbox with a value attribute', () => {
    const line = '[22] searchbox "" value="query"'
    const result = parseSnapshot(line)
    expect(result[0].backend_id).toBe(22)
    expect(result[0].role).toBe('searchbox')
    expect(result[0].name).toBe('')
    expect(result[0].snapshot_line).toBe(line)
  })

  it('parses a disabled link', () => {
    const line = '[18] link "past" (disabled)'
    const result = parseSnapshot(line)
    expect(result[0]).toEqual({
      backend_id: 18,
      role: 'link',
      name: 'past',
      snapshot_line: line,
    })
  })

  it('parses cursor-interactive "clickable" role', () => {
    const result = parseSnapshot('[99] clickable "Open menu"')
    expect(result[0].role).toBe('clickable')
    expect(result[0].name).toBe('Open menu')
  })

  it('parses a multi-line snapshot and preserves order', () => {
    const snapshot = [
      '[12] link "Hacker News"',
      '[14] link "new"',
      '[22] searchbox ""',
      '[25] button "Search"',
    ].join('\n')
    const result = parseSnapshot(snapshot)
    expect(result.length).toBe(4)
    expect(result.map((r) => r.backend_id)).toEqual([12, 14, 22, 25])
  })

  it('preserves snapshot_line byte-for-byte', () => {
    const line = '[100] button "foo\\"bar" (expanded, required)'
    const result = parseSnapshot(line)
    expect(result[0].snapshot_line).toBe(line)
  })

  it('throws SnapshotParseError for a line without [N] prefix', () => {
    expect(() => parseSnapshot('not a snapshot line')).toThrow(
      SnapshotParseError,
    )
  })

  it('throws SnapshotParseError for a line with wrong [N] format', () => {
    expect(() => parseSnapshot('[abc] button')).toThrow(SnapshotParseError)
  })
})
