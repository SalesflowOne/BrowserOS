import type { AcpPermissionDecision } from 'acpx-ai-provider'

// In-flight permission requests, keyed by thread → requestId. The
// onPermissionRequest callback registers a resolver here when it
// needs to escalate to the user, then awaits the promise. The HTTP
// endpoint (POST /threads/:id/permission/:requestId) calls resolve()
// to hand the decision back to acpx. turn.cancel calls cancelAll()
// to abort any still-pending requests with { outcome: 'cancel' }.
//
// Module-level singleton — fine because the bun main process owns
// the permission lifecycle, and concurrent threads get their own
// nested map.

interface Pending {
  resolve: (decision: AcpPermissionDecision) => void
}

const pending = new Map<string, Map<string, Pending>>()

export function register(
  threadId: string,
  requestId: string,
  entry: Pending,
): void {
  let bucket = pending.get(threadId)
  if (!bucket) {
    bucket = new Map()
    pending.set(threadId, bucket)
  }
  bucket.set(requestId, entry)
}

// Returns true if a pending entry existed and was resolved; false if
// the requestId is unknown (the API endpoint maps that to 409 so a
// double-click on Approve doesn't silently re-submit).
export function resolve(
  threadId: string,
  requestId: string,
  decision: AcpPermissionDecision,
): boolean {
  const bucket = pending.get(threadId)
  const entry = bucket?.get(requestId)
  if (!entry || !bucket) return false
  bucket.delete(requestId)
  if (bucket.size === 0) pending.delete(threadId)
  entry.resolve(decision)
  return true
}

// Removes an entry without resolving its promise. The caller has
// already settled the awaiting callback by other means (e.g. the
// acpx signal aborted independently of ChatSession.interrupt() —
// the abort listener resolves the outer promise but also has to
// clear the registry so a stale HTTP POST to the resolve endpoint
// doesn't pretend to succeed against an already-settled request).
//
// Returns true if there was an entry to remove; false otherwise.
export function deregister(threadId: string, requestId: string): boolean {
  const bucket = pending.get(threadId)
  if (!bucket?.delete(requestId)) return false
  if (bucket.size === 0) pending.delete(threadId)
  return true
}

// Drains every still-pending request for the thread as cancel. Called
// from ChatSession.cancel before the provider is disposed so the
// awaiting callback resolves cleanly (acpx sends a cancel response to
// the agent rather than letting the request time out).
export function cancelAll(threadId: string): string[] {
  const bucket = pending.get(threadId)
  if (!bucket) return []
  const ids = Array.from(bucket.keys())
  for (const entry of bucket.values()) {
    entry.resolve({ outcome: 'cancel' })
  }
  pending.delete(threadId)
  return ids
}

// Test/dev helper — count of in-flight requests, used by smoke checks
// to verify the registry doesn't leak entries after a turn ends.
export function pendingCount(threadId?: string): number {
  if (threadId !== undefined) {
    return pending.get(threadId)?.size ?? 0
  }
  let total = 0
  for (const b of pending.values()) total += b.size
  return total
}
