// Pub/sub for the single global search palette. Multiple surfaces
// open it (Cmd+K listener in Shell, rail's Search button) but only
// one SearchPalette component mounts and consumes. Same shape as
// composerFocusSignal, just with a subscription model because the
// palette needs to react to opens triggered while it's already
// mounted.
//
// Module-level state is the right move here: the palette is a
// singleton, the open boolean is ephemeral, and a context provider
// would add wiring at the app root for no extra power.

type Listener = (open: boolean) => void

let state = false
const listeners = new Set<Listener>()

function emit(): void {
  for (const fn of listeners) fn(state)
}

export function open(): void {
  if (state) return
  state = true
  emit()
}

export function close(): void {
  if (!state) return
  state = false
  emit()
}

export function toggle(): void {
  state = !state
  emit()
}

export function subscribe(fn: Listener): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}
