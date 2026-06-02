import type { Thread as TgThread } from 'chat'
import { eq } from 'drizzle-orm'
import type { Employee } from '../../db/schema/employees.sql.js'
import type { TelegramConnection } from '../../db/schema/telegram_connections.sql.js'
import { DEFAULT_THREAD_TITLE, threads } from '../../db/schema/threads.sql.js'
import { getDb } from '../db-singleton.js'
import {
  createThreadForChat,
  listRecentThreads,
  loadActiveThread,
  REASONING_EFFORTS,
  type ReasoningEffort,
  setActiveThread,
  type TelegramMessageLike,
  trimTitle,
} from './thread-store.js'

export interface CommandContext {
  connection: TelegramConnection
  employee: Employee
  tgThread: TgThread
  telegramChatId: string
  message: TelegramMessageLike
  text: string
}

export async function handleCommand(ctx: CommandContext): Promise<void> {
  const [head, ...rest] = ctx.text.split(/\s+/)
  const command = head?.toLowerCase()
  const args = rest.join(' ').trim()

  switch (command) {
    case '/start':
      return cmdStart(ctx)
    case '/help':
      return cmdHelp(ctx)
    case '/list':
      return cmdList(ctx)
    case '/new':
      return cmdNew(ctx, args)
    case '/switch':
      return cmdSwitch(ctx, args)
    case '/current':
      return cmdCurrent(ctx)
    case '/model':
      return cmdModel(ctx, args)
    case '/effort':
      return cmdEffort(ctx, args)
    default:
      await ctx.tgThread.post(
        `Unknown command. Try /help to see what's available.`,
      )
  }
}

async function cmdStart(ctx: CommandContext): Promise<void> {
  const active = await loadActiveThread(ctx.connection.id, ctx.telegramChatId)
  const greeting =
    `👋 You're chatting with *${ctx.employee.name}* — ${ctx.employee.role}.\n` +
    (active
      ? `Current thread: _${active.title}_`
      : `Send any message to start a new thread.`) +
    `\n\nTry /help to see what I can do.`
  await ctx.tgThread.post(greeting)
}

async function cmdHelp(ctx: CommandContext): Promise<void> {
  await ctx.tgThread.post(
    [
      '*Commands*',
      '/list — show 5 most recent threads in this chat',
      '/new [title] — start a fresh thread',
      '/switch <n> — switch to thread #n from /list',
      '/current — show the active thread',
      '/model <id> — override the model on the active thread',
      '/effort <none|low|medium|high> — set reasoning effort',
      '/help — show this message',
    ].join('\n'),
  )
}

async function cmdList(ctx: CommandContext): Promise<void> {
  const rows = await listRecentThreads(ctx.connection.id, ctx.telegramChatId)
  if (rows.length === 0) {
    await ctx.tgThread.post('No threads yet — send any message to start one.')
    return
  }
  const active = await loadActiveThread(ctx.connection.id, ctx.telegramChatId)
  const lines = rows.map((row, idx) => {
    const marker = active && row.id === active.id ? ' ← active' : ''
    return `${idx + 1}. ${row.title}${marker}`
  })
  await ctx.tgThread.post(`*Recent threads*\n${lines.join('\n')}`)
}

async function cmdNew(ctx: CommandContext, args: string): Promise<void> {
  const title = args ? trimTitle(args) : DEFAULT_THREAD_TITLE
  const threadId = await createThreadForChat({
    connection: ctx.connection,
    employee: ctx.employee,
    telegramChatId: ctx.telegramChatId,
    message: ctx.message,
    title,
  })
  await setActiveThread(ctx.connection.id, ctx.telegramChatId, threadId)
  await ctx.tgThread.post(`✨ Started new thread: _${title}_`)
}

async function cmdSwitch(ctx: CommandContext, args: string): Promise<void> {
  const n = Number.parseInt(args, 10)
  if (!Number.isFinite(n) || n < 1) {
    await ctx.tgThread.post('Usage: /switch <n> — pick a number from /list.')
    return
  }
  const rows = await listRecentThreads(ctx.connection.id, ctx.telegramChatId)
  const target = rows[n - 1]
  if (!target) {
    await ctx.tgThread.post(`No thread at position ${n}. Try /list.`)
    return
  }
  await setActiveThread(ctx.connection.id, ctx.telegramChatId, target.id)
  await ctx.tgThread.post(`Switched to thread: _${target.title}_`)
}

async function cmdCurrent(ctx: CommandContext): Promise<void> {
  const active = await loadActiveThread(ctx.connection.id, ctx.telegramChatId)
  if (!active) {
    await ctx.tgThread.post('No active thread. Send a message to start one.')
    return
  }
  await ctx.tgThread.post(`Active thread: _${active.title}_`)
}

async function cmdModel(ctx: CommandContext, args: string): Promise<void> {
  const active = await loadActiveThread(ctx.connection.id, ctx.telegramChatId)
  if (!active) {
    await ctx.tgThread.post('No active thread — send a message first.')
    return
  }
  const value = args.trim()
  await getDb()
    .update(threads)
    .set({ modelIdOverride: value || null, updatedAt: new Date() })
    .where(eq(threads.id, active.id))
  await ctx.tgThread.post(
    value
      ? `Model override set to \`${value}\` on this thread.`
      : 'Cleared model override on this thread.',
  )
}

async function cmdEffort(ctx: CommandContext, args: string): Promise<void> {
  const active = await loadActiveThread(ctx.connection.id, ctx.telegramChatId)
  if (!active) {
    await ctx.tgThread.post('No active thread — send a message first.')
    return
  }
  const value = args.trim().toLowerCase() as ReasoningEffort
  if (!REASONING_EFFORTS.includes(value)) {
    await ctx.tgThread.post('Usage: /effort <none|low|medium|high>')
    return
  }
  await getDb()
    .update(threads)
    .set({ reasoningEffortOverride: value, updatedAt: new Date() })
    .where(eq(threads.id, active.id))
  await ctx.tgThread.post(`Reasoning effort set to *${value}* on this thread.`)
}
