export interface ParsedSnapshotLine {
  backend_id: number
  role: string
  name: string
  snapshot_line: string
}

const LINE_RE = /^\[(\d+)\]\s+(\S+)(?:\s+"((?:[^"\\]|\\.)*)")?/

export class SnapshotParseError extends Error {
  constructor(
    message: string,
    public readonly lineIndex: number,
    public readonly line: string,
  ) {
    super(message)
    this.name = 'SnapshotParseError'
  }
}

export function parseSnapshot(snapshot: string): ParsedSnapshotLine[] {
  const lines = snapshot.split('\n')
  return lines.map((line, i) => {
    const match = line.match(LINE_RE)
    if (!match) {
      throw new SnapshotParseError(
        `Snapshot line ${i + 1} does not match [N] role format`,
        i,
        line,
      )
    }
    return {
      backend_id: Number.parseInt(match[1], 10),
      role: match[2],
      name: match[3] ?? '',
      snapshot_line: line,
    }
  })
}
