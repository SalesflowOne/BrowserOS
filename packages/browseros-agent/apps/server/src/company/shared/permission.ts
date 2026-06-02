// Shared between main process and renderer so the union is single-sourced.
// Order matches the picker dropdown's render order (safe modes first, the
// danger one last behind a separator).
export const PERMISSION_MODES = [
  'auto-approve-reads',
  'manual',
  'read-only',
  'allow-all',
] as const
export type PermissionMode = (typeof PERMISSION_MODES)[number]

export const DEFAULT_PERMISSION_MODE: PermissionMode = 'auto-approve-reads'

export function isPermissionMode(value: unknown): value is PermissionMode {
  return (
    typeof value === 'string' &&
    (PERMISSION_MODES as readonly string[]).includes(value)
  )
}

// Outcomes accepted on the HTTP resolution endpoint; map 1:1 to acpx's
// AcpPermissionDecision shapes. 'cancel' is server-emitted only (turn
// abort drains the registry); the renderer never POSTs it.
export const PERMISSION_DECISIONS = [
  'allow_once',
  'allow_always',
  'reject_once',
  'reject_always',
] as const
export type PermissionDecision = (typeof PERMISSION_DECISIONS)[number]

// Server-side outcome union that includes the cancel path. Used on the
// permission.resolved event payload.
export type PermissionOutcome = PermissionDecision | 'cancel'

// Mirrors acpx's inferToolKind classifier. Null in the event payload
// covers the "could not infer" case — UI falls back to a generic icon.
export type PermissionToolKind =
  | 'read'
  | 'search'
  | 'fetch'
  | 'edit'
  | 'execute'
  | 'delete'
  | 'move'
  | 'switch_mode'
  | 'think'
  | 'other'
