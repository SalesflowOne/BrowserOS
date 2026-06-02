import type { ChatEvent } from '../../db/schema/events.sql.js'

type Subscriber = (event: ChatEvent) => void

class EventBus {
  private readonly subscribers = new Map<string, Set<Subscriber>>()
  // Cross-thread listeners. The notification dispatcher uses this to
  // see every emit regardless of which thread fired it, without
  // having to subscribe per-thread as new threads are created.
  private readonly wildcards = new Set<Subscriber>()

  subscribe(threadId: string, fn: Subscriber): () => void {
    let set = this.subscribers.get(threadId)
    if (!set) {
      set = new Set()
      this.subscribers.set(threadId, set)
    }
    set.add(fn)
    return () => {
      const current = this.subscribers.get(threadId)
      if (!current) return
      current.delete(fn)
      if (current.size === 0) this.subscribers.delete(threadId)
    }
  }

  subscribeAll(fn: Subscriber): () => void {
    this.wildcards.add(fn)
    return () => {
      this.wildcards.delete(fn)
    }
  }

  publish(threadId: string, event: ChatEvent): void {
    const set = this.subscribers.get(threadId)
    if (set) {
      for (const fn of set) {
        try {
          fn(event)
        } catch {
          // A misbehaving subscriber must not block the publish loop.
        }
      }
    }
    for (const fn of this.wildcards) {
      try {
        fn(event)
      } catch {
        // Same rule for wildcards — never let one bad listener gate
        // delivery to the rest.
      }
    }
  }
}

let _bus: EventBus | null = null

export function getEventBus(): EventBus {
  if (!_bus) _bus = new EventBus()
  return _bus
}
