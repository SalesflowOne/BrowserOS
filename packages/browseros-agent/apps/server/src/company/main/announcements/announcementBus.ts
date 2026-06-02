import type { Announcement } from '../../db/schema/announcements.sql.js'

type Subscriber = (announcement: Announcement) => void

// Process-local pubsub for `announcement.posted` events. Mirrors the
// shape of the chat event bus but flat (no per-thread keying): every
// open AnnouncementsView listens to one global stream.
class AnnouncementBus {
  private readonly subscribers = new Set<Subscriber>()

  subscribe(fn: Subscriber): () => void {
    this.subscribers.add(fn)
    return () => {
      this.subscribers.delete(fn)
    }
  }

  publish(announcement: Announcement): void {
    for (const fn of this.subscribers) {
      try {
        fn(announcement)
      } catch {
        // A misbehaving subscriber must not block the publish loop.
      }
    }
  }
}

let _bus: AnnouncementBus | null = null

export function getAnnouncementBus(): AnnouncementBus {
  if (!_bus) _bus = new AnnouncementBus()
  return _bus
}
