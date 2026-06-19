const APPROX_CHARS_PER_TOKEN = 3

/** Estimates plain text tokens with the same chars/3 heuristic used by compaction. */
export function estimateTextTokens(text: string): number {
  return Math.ceil(text.length / APPROX_CHARS_PER_TOKEN)
}
