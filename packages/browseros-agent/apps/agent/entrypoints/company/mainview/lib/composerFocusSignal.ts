// One-shot signal for "the next ChatSurface mount should grab focus
// for the user." The only consumer is the create-then-navigate flow
// in NewThreadScreen: the source textarea is about to unmount and
// the destination one needs focus the moment it mounts.
//
// Module-local boolean rather than a hook/context/store because
// (a) producer and consumer live in different routes that don't
// share a React tree, (b) the value lives for at most one tick —
// between NewThread's navigate() and ChatSurface's first useEffect
// — so reactivity is useless, (c) keeping it out of React means
// zero extra renders and zero subscription bookkeeping.

let pending = false

export function requestFocus(): void {
  pending = true
}

export function clearFocusRequest(): void {
  pending = false
}

// Returns true at most once per `requestFocus()` call. Consume sites
// (ChatSurface's mount effect) call this in a useEffect; if true,
// they focus their Composer. StrictMode's double-invoked mount
// effect is safe — the second call sees `pending=false`.
export function consumeFocusRequest(): boolean {
  if (!pending) return false
  pending = false
  return true
}
