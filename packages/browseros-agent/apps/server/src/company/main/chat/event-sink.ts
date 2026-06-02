import { desc, eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { type ChatEvent, events } from '../../db/schema/events.sql.js'
import type { DB } from '../../db/types.js'
import { getEventBus } from './eventBus.js'
import type { ProtocolEvent } from './events.types.js'

// Single funnel for writing chat events. Owns the monotonic seq per
// thread (seeded from the highest existing row on construction).
export class EventSink {
  private nextSeq: number | null = null

  constructor(
    private readonly db: DB,
    private readonly threadId: string,
  ) {}

  async emit(protocolEvent: ProtocolEvent): Promise<ChatEvent> {
    const seq = await this.allocateSeq()
    const row: ChatEvent = {
      id: nanoid(),
      threadId: this.threadId,
      seq,
      kind: protocolEvent.type,
      payload: JSON.stringify(protocolEvent.payload),
      ts: new Date(),
    }
    await this.db.insert(events).values(row)
    getEventBus().publish(this.threadId, row)
    return row
  }

  private async allocateSeq(): Promise<number> {
    if (this.nextSeq === null) {
      const latest = await this.db
        .select()
        .from(events)
        .where(eq(events.threadId, this.threadId))
        .orderBy(desc(events.seq))
        .limit(1)
      this.nextSeq = (latest[0]?.seq ?? -1) + 1
    }
    const seq = this.nextSeq
    this.nextSeq = seq + 1
    return seq
  }
}
