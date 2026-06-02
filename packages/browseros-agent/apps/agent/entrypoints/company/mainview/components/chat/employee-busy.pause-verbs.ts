// Verbs shown when a PermissionPart sits in `state: 'pending'`. The
// agent isn't working, it's waiting for the founder to approve or
// deny a tool call. Highest precedence in `selectVerb` so the row
// reads honestly during a 30s / 2m / 10m pause instead of cycling
// role verbs.
export const PAUSE_VERBS = [
  'waiting for your approval',
  'paused, needs your call',
  'waiting on you',
  'holding for the go-ahead',
] as const
