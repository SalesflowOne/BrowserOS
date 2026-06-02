import { eq } from 'drizzle-orm'
import { employees } from '../../db/schema/employees.sql.js'
import { threads } from '../../db/schema/threads.sql.js'
import type { DB } from '../../db/types.js'
import { getDb } from '../db-singleton.js'
import { buildAgentMcpServers } from './agent-mcp-servers.js'
import { ChatSession } from './ChatSession.js'
import { effectiveTuple } from './tuple.js'

// One ChatSession per thread. The session owns its own AcpxProvider
// and replaces it internally when the user changes agent/workspace;
// no per-tuple cache lives here. The manager just owns lifetime
// (build once, dispose on app shutdown).
class SessionManager {
  private readonly sessions = new Map<string, ChatSession>()
  private readonly pending = new Map<string, Promise<ChatSession>>()

  async getOrStart(threadId: string): Promise<ChatSession> {
    const existing = this.sessions.get(threadId)
    if (existing) return existing
    const inflight = this.pending.get(threadId)
    if (inflight) return inflight

    const promise = this.create(getDb(), threadId)
    this.pending.set(threadId, promise)
    try {
      const session = await promise
      this.sessions.set(threadId, session)
      return session
    } finally {
      this.pending.delete(threadId)
    }
  }

  get(threadId: string): ChatSession | undefined {
    return this.sessions.get(threadId)
  }

  async dispose(threadId: string): Promise<void> {
    const session = this.sessions.get(threadId)
    if (!session) return
    this.sessions.delete(threadId)
    await session.dispose()
  }

  async disposeForThreads(threadIds: readonly string[]): Promise<void> {
    const victims: ChatSession[] = []
    for (const id of threadIds) {
      const session = this.sessions.get(id)
      if (!session) continue
      this.sessions.delete(id)
      victims.push(session)
    }
    await Promise.allSettled(victims.map((s) => s.dispose()))
  }

  async disposeAll(): Promise<void> {
    const all = [...this.sessions.values()]
    this.sessions.clear()
    await Promise.allSettled(all.map((s) => s.dispose()))
  }

  private async create(db: DB, threadId: string): Promise<ChatSession> {
    const thread = await db
      .select()
      .from(threads)
      .where(eq(threads.id, threadId))
      .limit(1)
    const threadRow = thread[0]
    if (!threadRow) throw new Error(`thread not found: ${threadId}`)

    const employee = await db
      .select()
      .from(employees)
      .where(eq(employees.id, threadRow.employeeId))
      .limit(1)
    const employeeRow = employee[0]
    if (!employeeRow) {
      throw new Error(`employee not found: ${threadRow.employeeId}`)
    }

    const mcpServers = await buildAgentMcpServers(db, employeeRow, threadRow)
    const tuple = effectiveTuple(threadRow, employeeRow)

    return new ChatSession({
      db,
      employee: employeeRow,
      thread: threadRow,
      tuple,
      mcpServers,
    })
  }
}

let _manager: SessionManager | null = null

export function getSessionManager(): SessionManager {
  if (!_manager) _manager = new SessionManager()
  return _manager
}
