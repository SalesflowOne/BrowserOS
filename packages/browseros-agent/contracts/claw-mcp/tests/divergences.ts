/**
 * Machine-checked twin of DIVERGENCES.md: every known, accepted
 * behavioral difference between the two claw servers, by id. Cases
 * reference these ids when they branch per server or exclude a parity
 * key from cross-server comparison; the parity gate rejects unknown
 * ids, so a NEW divergence can only land by being registered here AND
 * documented in DIVERGENCES.md.
 */

export interface Divergence {
  id: string
  description: string
  rust: string
  typescript: string
}

export const DIVERGENCES: Divergence[] = [
  {
    id: 'snapshot-mode-param',
    description: 'snapshot `mode` parameter (full|interactive)',
    rust: 'supported; interactive prunes non-interactive branches',
    typescript: 'not in the input schema; full snapshot only',
  },
  {
    id: 'snapshot-depth-param',
    description: 'snapshot `depth` parameter (1..=100)',
    rust: 'supported; truncates the rendered tree at the given depth',
    typescript: 'not in the input schema',
  },
  {
    id: 'act-dialog-kinds',
    description: 'act kinds dialog_accept / dialog_dismiss',
    rust: 'supported; resolves the pending JS dialog',
    typescript: 'not in the kind enum; call is rejected',
  },
  {
    id: 'read-console-format',
    description: 'read format=console',
    rust: 'supported; returns captured console entries',
    typescript: 'format enum is markdown|text|links only',
  },
  {
    id: 'tabs-new-snapshot',
    description: 'auto-context on tabs action=new',
    rust: 'embeds a fresh [Page N snapshot] block',
    typescript: 'returns only `opened page N`, no snapshot embed',
  },
  {
    id: 'act-console-summary',
    description: 'console summary in act auto-context',
    rust: 'appends `[page N console] …` when the action logged errors/warnings',
    typescript: 'act embeds the settled diff only',
  },
  {
    id: 'act-check-kind',
    description: 'act kinds check / uncheck',
    rust: 'broken: fails with `CDP error: Invalid parameters`',
    typescript: 'works; sets the checkbox state and reports ok (check)',
  },
  {
    id: 'delete-hygiene-content-type',
    description: 'DELETE /mcp teardown without a content-type header',
    rust: 'accepted; bodyless DELETE is exempt from the json content-type check',
    typescript:
      'rejected with 415; teardown DELETE must send content-type: application/json',
  },
  {
    id: 'windows-set-visibility',
    description: 'windows action=set_visibility',
    rust: 'broken: fails with `CDP error: Invalid parameters` for hide and show',
    typescript:
      'hide succeeds but recreates the window (`set window X hidden; new window id Y`); the old id is dead afterwards',
  },
  {
    id: 'ownership-error-wording',
    description: 'ownership-guard error text for a foreign page',
    rust: 'single wording: `page N is not owned by this agent; …`',
    typescript:
      'names the owning session when known: `page N is owned by <title>; …`',
  },
]

const byId = new Map(DIVERGENCES.map((entry) => [entry.id, entry]))

export function getDivergence(id: string): Divergence {
  const entry = byId.get(id)
  if (!entry) {
    throw new Error(
      `unknown divergence id "${id}" — register it in divergences.ts and document it in DIVERGENCES.md`,
    )
  }
  return entry
}
