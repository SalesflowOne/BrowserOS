// Rail status surface shown on the employee avatar (and per-thread row).
// Derived server-side from threads + events; see
// `apps/desktop/src/main/chat/rail-status.ts` for the precedence rules.
//
// `working` / `pending` / `attention` / `idle` are populated today.
// `offline` and `awaiting_approval` are reserved enum slots — they
// need infrastructure (per-employee liveness signal, approval-status
// aggregation) that's not in place yet.
export type Status =
  | 'working'
  | 'pending'
  | 'attention'
  | 'idle'
  | 'offline'
  | 'awaiting_approval'
