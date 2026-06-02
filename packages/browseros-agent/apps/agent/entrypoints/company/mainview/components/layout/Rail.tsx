// biome-ignore-all lint/nursery/noExcessiveLinesPerFile: the navigation rail is one coherent surface; sub-component extraction lives in the same file for locality

import { CreateChannelDialog } from '@company/components/channels/CreateChannelDialog'
import { Avatar } from '@company/components/chat/Avatar'
import { HireDialog } from '@company/components/chat/HireDialog'
import { NewChatDialog } from '@company/components/chat/NewChatDialog'
import { TelegramGlyph } from '@company/components/chat/TelegramGlyph'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@company/components/ui/alert-dialog'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@company/components/ui/context-menu'
import { Input } from '@company/components/ui/input'
import {
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from '@company/components/ui/sidebar'
import { formatRelativeShort } from '@company/lib/relativeTime'
import * as searchPaletteSignal from '@company/lib/searchPaletteSignal'
import type { Tint } from '@company/lib/tints'
import { cn } from '@company/lib/utils'
import { usePendingApprovals } from '@company/modules/api/approvals.hooks'
import { useChannels } from '@company/modules/api/channels.hooks'
import {
  type EmployeeWithRecent,
  type RecentThread,
  useEmployeesWithRecentThreads,
  useFireEmployee,
} from '@company/modules/api/employees.hooks'
import { toastError } from '@company/modules/api/errorToast'
import {
  type ThreadRow,
  useArchiveThread,
  useEmployeeThreads,
  useRenameThread,
} from '@company/modules/api/threads.hooks'
import { useMinuteTick } from '@company/modules/lib/useMinuteTick'
import {
  Link,
  useNavigate,
  useParams,
  useRouterState,
} from '@tanstack/react-router'
import {
  ChevronDown,
  ChevronRight,
  Hash,
  Megaphone,
  Moon,
  Plus,
  Search,
  Settings2,
  Sun,
  UserPlus,
} from 'lucide-react'
import { useTheme } from 'next-themes'
import { type FC, useEffect, useMemo, useState } from 'react'

const RECENT_LIMIT = 5

export const Rail: FC = () => {
  const employees = useEmployeesWithRecentThreads({
    variables: { limit: RECENT_LIMIT },
  })
  const pending = usePendingApprovals()
  const params = useParams({ strict: false }) as {
    employeeId?: string
    threadId?: string
    channelId?: string
  }
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const isOnNewView = pathname.endsWith('/new')
  const [hireOpen, setHireOpen] = useState(false)
  const [channelDialogOpen, setChannelDialogOpen] = useState(false)
  const channels = useChannels()
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [seeAll, setSeeAll] = useState<Set<string>>(new Set())
  // Force every relative timestamp in the rail to re-render on the same
  // tick so we don't grow N intervals with N threads.
  useMinuteTick()

  // Whenever the active employee changes, force their threads section
  // expanded. The user can still collapse it via the chevron after,
  // but landing on an employee — whether via row click, direct URL, or
  // a thread link from elsewhere — should always reveal that employee's
  // threads. `seeAll` is left alone here: it only resets when the user
  // explicitly clicks 'Show less' or folds the section via the chevron.
  useEffect(() => {
    if (!params.employeeId) return
    const id = params.employeeId
    setExpanded((prev) => (prev[id] ? prev : { ...prev, [id]: true }))
  }, [params.employeeId])

  const pendingByEmployee = (pending.data ?? []).reduce<Record<string, number>>(
    (acc, ap) => {
      acc[ap.proposerEmployeeId] = (acc[ap.proposerEmployeeId] ?? 0) + 1
      return acc
    },
    {},
  )

  // Sort employees by latest thread activity; new hires with no threads
  // sink to the bottom in hire order so the rail keeps a deterministic
  // shape when activity is sparse.
  const sortedEmployees = useMemo(() => {
    const list = [...(employees.data ?? [])]
    list.sort((a, b) => {
      const aT = a.lastActivityAt ?? 0
      const bT = b.lastActivityAt ?? 0
      if (aT !== bT) return bT - aT
      return a.hiredAt - b.hiredAt
    })
    return list
  }, [employees.data])

  return (
    <>
      <SidebarGroup>
        <SidebarGroupContent>
          <SidebarMenu>
            <NewChatItem />
            <SearchItem />
            <SidebarMenuItem>
              <SidebarMenuButton
                render={<Link to="/announcements" />}
                isActive={pathname.startsWith('/announcements')}
              >
                <Megaphone />
                <span>Announcements</span>
              </SidebarMenuButton>
              {pending.data && pending.data.length > 0 ? (
                <SidebarMenuBadge>{pending.data.length}</SidebarMenuBadge>
              ) : null}
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton
                render={<Link to="/settings" />}
                isActive={pathname.startsWith('/settings')}
              >
                <Settings2 />
                <span>Settings</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>

      <SidebarGroup>
        <SidebarGroupLabel>Channels</SidebarGroupLabel>
        <SidebarGroupAction
          onClick={() => setChannelDialogOpen(true)}
          title="New channel"
        >
          <Plus />
          <span className="sr-only">New channel</span>
        </SidebarGroupAction>
        <SidebarGroupContent>
          <SidebarMenu>
            {(channels.data ?? []).map((channel) => (
              <SidebarMenuItem key={channel.id}>
                <SidebarMenuButton
                  render={
                    <Link
                      to="/c/$channelId"
                      params={{ channelId: channel.id }}
                    />
                  }
                  isActive={params.channelId === channel.id}
                  title={channel.topic ?? channel.name}
                >
                  <Hash />
                  <span className="truncate">{channel.name}</span>
                  {channel.memberCount > 0 ? (
                    <span className="ml-auto text-[10.5px] text-muted-foreground tabular-nums">
                      {channel.memberCount}
                    </span>
                  ) : null}
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
            {(channels.data ?? []).length === 0 ? (
              <SidebarMenuItem>
                <button
                  type="button"
                  onClick={() => setChannelDialogOpen(true)}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-muted-foreground text-xs transition-colors hover:text-foreground"
                >
                  <Plus className="size-3" />
                  Create your first channel
                </button>
              </SidebarMenuItem>
            ) : null}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>

      <SidebarGroup>
        <SidebarGroupLabel>Team</SidebarGroupLabel>
        <SidebarGroupAction
          onClick={() => setHireOpen(true)}
          title="Hire someone"
        >
          <UserPlus />
          <span className="sr-only">Hire someone</span>
        </SidebarGroupAction>
        <SidebarGroupContent>
          <SidebarMenu>
            {sortedEmployees.map((employee) => (
              <EmployeeBlock
                key={employee.id}
                employee={employee}
                pending={pendingByEmployee[employee.id] ?? 0}
                expanded={expanded[employee.id] ?? false}
                isActiveEmployee={params.employeeId === employee.id}
                activeThreadId={params.threadId ?? null}
                isOnNewView={isOnNewView}
                seeAll={seeAll.has(employee.id)}
                onToggle={() => {
                  // Folding via the chevron resets `see all` — when the
                  // section re-opens it starts at the capped recent
                  // list rather than the full backlog.
                  const wasExpanded = expanded[employee.id] ?? false
                  const nowExpanded = !wasExpanded
                  setExpanded((prev) => ({
                    ...prev,
                    [employee.id]: nowExpanded,
                  }))
                  if (!nowExpanded) {
                    setSeeAll((prev) => {
                      if (!prev.has(employee.id)) return prev
                      const next = new Set(prev)
                      next.delete(employee.id)
                      return next
                    })
                  }
                }}
                onRowClick={() => {
                  // Row click forces the section open; `seeAll` is left
                  // alone so an explicit 'Show all' the user enabled
                  // earlier survives navigation between this employee's
                  // threads.
                  setExpanded((prev) => ({ ...prev, [employee.id]: true }))
                }}
                onSeeMore={() =>
                  setSeeAll((prev) => {
                    const next = new Set(prev)
                    if (next.has(employee.id)) next.delete(employee.id)
                    else next.add(employee.id)
                    return next
                  })
                }
              />
            ))}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>

      <HireDialog open={hireOpen} onOpenChange={setHireOpen} />
      <CreateChannelDialog
        open={channelDialogOpen}
        onOpenChange={setChannelDialogOpen}
      />
    </>
  )
}

const NewChatItem: FC = () => {
  const [open, setOpen] = useState(false)
  // Cmd/Ctrl+N anywhere in the app opens the popup. Skipped when the
  // user is typing in an input/textarea/contentEditable so it never
  // hijacks the composer's own shortcuts.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return
      if (e.key.toLowerCase() !== 'n') return
      const target = e.target as HTMLElement | null
      const tag = target?.tagName
      if (
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        target?.isContentEditable === true
      ) {
        return
      }
      e.preventDefault()
      setOpen(true)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])
  return (
    <>
      <SidebarMenuItem>
        <SidebarMenuButton
          onClick={() => setOpen(true)}
          className="font-medium"
        >
          <Plus />
          <span>New chat</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
      <NewChatDialog open={open} onOpenChange={setOpen} />
    </>
  )
}

// Detected once at module load — navigator.platform is deprecated
// but still the cheapest reliable signal inside an Electron
// renderer. userAgentData would need an async call we don't want
// on render. Recomputing on every <SearchItem /> render was wasteful
// for a value that never changes.
const IS_MAC =
  typeof navigator !== 'undefined' && /mac/i.test(navigator.platform ?? '')
const SEARCH_SHORTCUT = IS_MAC ? '⌘K' : '^K'

const SearchItem: FC = () => {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        onClick={() => searchPaletteSignal.open()}
        tooltip={`Search threads + messages (${SEARCH_SHORTCUT})`}
        className="font-medium"
      >
        <Search />
        <span>Search</span>
        <kbd className="ml-auto rounded border border-border/60 bg-muted px-1 py-0.5 font-mono text-[10px] text-muted-foreground">
          {SEARCH_SHORTCUT}
        </kbd>
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}

const EmployeeBlock: FC<{
  employee: EmployeeWithRecent
  pending: number
  expanded: boolean
  isActiveEmployee: boolean
  activeThreadId: string | null
  isOnNewView: boolean
  seeAll: boolean
  onToggle: () => void
  onRowClick: () => void
  onSeeMore: () => void
}> = ({
  employee,
  pending,
  expanded,
  isActiveEmployee,
  activeThreadId,
  isOnNewView,
  seeAll,
  onToggle,
  onRowClick,
  onSeeMore,
}) => {
  const tint = employee.tint as Tint
  const lastActivity = employee.lastActivityAt
  const recent = employee.recentThreads[0]
  // The row itself stays "active" only when the user is inside one of
  // this employee's threads — not when on /new (the New thread sub-item
  // owns the active state in that case).
  const rowActive = isActiveEmployee && !isOnNewView
  return (
    <SidebarMenuItem>
      <EmployeeRowButton
        employee={employee}
        tint={tint}
        recent={recent}
        rowActive={rowActive}
        pending={pending}
        lastActivity={lastActivity}
        onRowClick={onRowClick}
      />
      <SidebarMenuAction
        onClick={onToggle}
        aria-label={expanded ? 'Collapse threads' : 'Expand threads'}
      >
        {expanded ? <ChevronDown /> : <ChevronRight />}
      </SidebarMenuAction>

      {expanded ? (
        <EmployeeThreads
          employeeId={employee.id}
          recentThreads={employee.recentThreads}
          totalCount={employee.totalThreadCount}
          activeThreadId={isActiveEmployee ? activeThreadId : null}
          isOnNewView={isActiveEmployee && isOnNewView}
          seeAll={seeAll}
          onToggleSeeAll={onSeeMore}
        />
      ) : null}
    </SidebarMenuItem>
  )
}

const EmployeeRowButton: FC<{
  employee: EmployeeWithRecent
  tint: Tint
  recent: RecentThread | undefined
  rowActive: boolean
  pending: number
  lastActivity: number | null
  onRowClick: () => void
}> = ({
  employee,
  tint,
  recent,
  rowActive,
  pending,
  lastActivity,
  onRowClick,
}) => {
  // Skip the secondary role line when it would just repeat the name
  // (e.g. "Chief of Staff" / "Chief of Staff"). Otherwise stack name
  // over a muted, smaller role descriptor — the same rhythm the chat
  // surface header uses.
  const showRole = Boolean(employee.role) && employee.role !== employee.name
  const body = (
    <>
      <Avatar
        monogram={employee.monogram}
        tint={tint}
        status={employee.railStatus}
        size="sm"
        className="shrink-0"
      />
      <div className="flex min-w-0 flex-1 flex-col leading-tight">
        <span className="truncate text-sm">{employee.name}</span>
        {showRole ? (
          <span className="truncate text-[11px] text-muted-foreground">
            {employee.role}
          </span>
        ) : null}
      </div>
      {pending > 0 ? null : lastActivity ? (
        // No right-padding here on purpose: shadcn's SidebarMenuButton
        // already applies pr-8 when a SidebarMenuAction is present
        // (`group-has-data-[sidebar=menu-action]/menu-item:pr-8`), so the
        // timestamp sits flush against the reserved chevron gutter.
        <span className="shrink-0 font-mono text-[11px] text-muted-foreground/60 tabular-nums">
          {formatRelativeShort(lastActivity)}
        </span>
      ) : null}
    </>
  )
  const fire = useFireEmployee()
  const navigate = useNavigate()
  const activeEmployeeId = useParams({ strict: false }).employeeId as
    | string
    | undefined
  const [confirmFire, setConfirmFire] = useState(false)

  const onConfirmFire = async () => {
    try {
      await fire.mutateAsync({ id: employee.id })
      setConfirmFire(false)
      if (activeEmployeeId === employee.id) {
        void navigate({ to: '/' })
      }
    } catch (err) {
      toastError(err, `Could not let ${employee.name} go`)
    }
  }

  // SidebarMenuButton's render prop swaps the underlying tag — Link when
  // the employee has a thread to land on, Link to /new otherwise. Either
  // way the active styling comes from isActive. onClick fires alongside
  // the Link's navigation and expands+resets the threads section so a
  // row click after a manual collapse reveals the list again. size="lg"
  // gives the row enough height (h-12) for the two-line name/role stack
  // and bumps the chevron's vertical position via shadcn's
  // peer-data-[size=lg]/menu-button:top-2.5 rule.
  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger className="block w-full">
          <SidebarMenuButton
            size="lg"
            isActive={rowActive}
            title={employee.name}
            onClick={onRowClick}
            render={
              recent ? (
                <Link
                  to="/e/$employeeId/t/$threadId"
                  params={{ employeeId: employee.id, threadId: recent.id }}
                />
              ) : (
                <Link
                  to="/e/$employeeId/new"
                  params={{ employeeId: employee.id }}
                />
              )
            }
          >
            {body}
          </SidebarMenuButton>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem
            variant="destructive"
            onClick={() => setConfirmFire(true)}
          >
            Let {employee.name} go
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      {pending > 0 ? <SidebarMenuBadge>{pending}</SidebarMenuBadge> : null}
      <AlertDialog open={confirmFire} onOpenChange={setConfirmFire}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Let {employee.name} go?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes {employee.name} from your team. Every thread they own
              goes with them, and the deletion can't be undone from the UI.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={fire.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={onConfirmFire}
              disabled={fire.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {fire.isPending ? 'Letting go…' : 'Let go'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

// The "see all" path falls back to the per-employee /threads endpoint,
// which doesn't yet carry the rail-status overlay. Widen the row type
// so ThreadEntry can accept either shape and render the rich icon when
// the data has it, the legacy dot otherwise.
type RailThread = RecentThread | ThreadRow

const EmployeeThreads: FC<{
  employeeId: string
  recentThreads: RecentThread[]
  totalCount: number
  activeThreadId: string | null
  isOnNewView: boolean
  seeAll: boolean
  onToggleSeeAll: () => void
}> = ({
  employeeId,
  recentThreads,
  totalCount,
  activeThreadId,
  isOnNewView,
  seeAll,
  onToggleSeeAll,
}) => {
  // Only fire the full-list query when the user actually asks for it —
  // most employees stay capped at the rail's RECENT_LIMIT.
  const fullList = useEmployeeThreads({
    variables: { employeeId },
    enabled: seeAll,
  })
  const allSorted = useMemo<RailThread[] | null>(() => {
    if (!seeAll) return null
    return [...(fullList.data ?? [])].sort((a, b) => b.updatedAt - a.updatedAt)
  }, [seeAll, fullList.data])

  const threads: RailThread[] = seeAll
    ? (allSorted ?? recentThreads)
    : recentThreads
  const remaining = totalCount - RECENT_LIMIT

  return (
    // Drop the primitive's default `mx-3.5 px-2.5` right inset so the
    // sub-rows extend to the rail's right edge — the same area the
    // employee row's timestamps occupy. The `ml-3.5 pl-2.5` left side
    // is kept because the border-l connector renders there.
    <SidebarMenuSub className="mr-0 pr-0">
      {/* New-thread CTA is the FIRST sub-item so it stays reachable
       * regardless of how many threads the employee has accumulated. */}
      <SidebarMenuSubItem>
        <SidebarMenuSubButton
          render={<Link to="/e/$employeeId/new" params={{ employeeId }} />}
          isActive={isOnNewView}
          className="text-muted-foreground"
        >
          <Plus className="size-3" />
          <span>New thread</span>
        </SidebarMenuSubButton>
      </SidebarMenuSubItem>

      {threads.map((t) => (
        <ThreadEntry
          key={t.id}
          employeeId={employeeId}
          thread={t}
          active={activeThreadId === t.id}
        />
      ))}

      {remaining > 0 ? (
        <SidebarMenuSubItem>
          <button
            type="button"
            onClick={onToggleSeeAll}
            className="flex h-6 w-full items-center rounded-md px-2 text-left text-[11.5px] text-muted-foreground/70 transition-colors hover:text-foreground"
          >
            {seeAll ? 'Show less' : `Show ${remaining} more`}
          </button>
        </SidebarMenuSubItem>
      ) : null}
    </SidebarMenuSub>
  )
}

// Per-thread row icon — mirrors herbie's ConversationIcon precedence
// (streaming wins over unread, default icon at rest). When the rail's
// "see all" fallback hands us a ThreadRow without rail-status fields,
// we degrade to the legacy active/general/muted dot palette so older
// rows still render distinctly.
const ThreadRowIcon: FC<{
  thread: RailThread
  active: boolean
}> = ({ thread, active }) => {
  const railStatus = 'railStatus' in thread ? thread.railStatus : undefined
  const unread = 'unread' in thread ? thread.unread : false
  if (railStatus === 'working' || railStatus === 'pending') {
    return <TypingDots />
  }
  if (unread) {
    // Same cool blue as the Avatar's `attention` status dot. One state
    // ("agent finished, founder hasn't acknowledged") → one colour
    // across both surfaces. Orange stays reserved for active/in-flight
    // states (selected row, streaming dots).
    return (
      <span
        aria-hidden
        style={{ backgroundColor: 'oklch(0.66 0.18 250)' }}
        className="size-1.5 shrink-0 rounded-full"
      />
    )
  }
  return (
    <span
      aria-hidden
      className={cn(
        'size-1 shrink-0 rounded-full',
        active
          ? 'bg-[color:var(--accent-orange)]'
          : thread.isGeneral
            ? 'bg-[color:var(--accent-orange)]/70'
            : 'bg-muted-foreground/40',
      )}
    />
  )
}

const TypingDots: FC = () => (
  <span
    aria-hidden
    className="inline-flex shrink-0 items-center justify-center gap-0.5"
  >
    <span className="size-1 animate-pulse rounded-full bg-[color:var(--accent-orange)]" />
    <span className="size-1 animate-pulse rounded-full bg-[color:var(--accent-orange)] [animation-delay:150ms]" />
    <span className="size-1 animate-pulse rounded-full bg-[color:var(--accent-orange)] [animation-delay:300ms]" />
  </span>
)

const ThreadEntry: FC<{
  employeeId: string
  thread: RailThread
  active: boolean
}> = ({ employeeId, thread, active }) => {
  const rename = useRenameThread()
  const archive = useArchiveThread()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(thread.title)
  const [confirmArchive, setConfirmArchive] = useState(false)

  const startEdit = () => {
    setDraft(thread.title)
    setEditing(true)
  }

  const commitEdit = () => {
    const next = draft.trim()
    setEditing(false)
    if (!next || next === thread.title) return
    rename.mutate(
      { id: thread.id, title: next },
      { onError: (err) => toastError(err, 'Could not rename thread') },
    )
  }

  const cancelEdit = () => {
    setEditing(false)
    setDraft(thread.title)
  }

  const onArchive = () => {
    archive.mutate(
      { id: thread.id },
      {
        onSuccess: () => setConfirmArchive(false),
        onError: (err) => toastError(err, 'Could not archive thread'),
      },
    )
  }

  return (
    <SidebarMenuSubItem>
      <ContextMenu>
        <ContextMenuTrigger className="block">
          {editing ? (
            <div className="flex items-center gap-2 rounded-md bg-accent/40 px-2 py-1">
              <ThreadRowIcon thread={thread} active={active} />
              <Input
                autoFocus
                value={draft}
                onFocus={(e) => e.currentTarget.select()}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    commitEdit()
                  } else if (e.key === 'Escape') {
                    e.preventDefault()
                    cancelEdit()
                  }
                }}
                onBlur={commitEdit}
                className="h-6 border-0 bg-transparent px-0 py-0 text-[13px] shadow-none focus-visible:ring-0"
                disabled={rename.isPending}
              />
            </div>
          ) : (
            <SidebarMenuSubButton
              render={
                <Link
                  to="/e/$employeeId/t/$threadId"
                  params={{ employeeId, threadId: thread.id }}
                />
              }
              isActive={active}
            >
              <ThreadRowIcon thread={thread} active={active} />
              <ThreadEntryLabel thread={thread} />
            </SidebarMenuSubButton>
          )}
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onClick={startEdit}>Rename</ContextMenuItem>
          <ContextMenuItem
            onClick={() => setConfirmArchive(true)}
            variant="destructive"
          >
            Archive
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      <AlertDialog open={confirmArchive} onOpenChange={setConfirmArchive}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive this thread?</AlertDialogTitle>
            <AlertDialogDescription>
              "{thread.title}" will be hidden from the sidebar. There's no
              archive screen yet, so restoring it requires API access.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={archive.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={onArchive}
              disabled={archive.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {archive.isPending ? 'Archiving…' : 'Archive'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SidebarMenuSubItem>
  )
}

const ThreadEntryLabel: FC<{ thread: RailThread }> = ({ thread }) => {
  const link = thread.telegramLink
  const linkLabel = link
    ? `Reachable via Telegram (${link.botUsername ? `@${link.botUsername}` : link.botName})`
    : null
  return (
    <>
      <span className="min-w-0 flex-1 truncate">{thread.title}</span>
      {link ? (
        <TelegramGlyph
          className="size-3 shrink-0 text-muted-foreground/60"
          aria-label={linkLabel ?? undefined}
        />
      ) : null}
      <span className="shrink-0 font-mono text-[10.5px] text-muted-foreground/50 tabular-nums">
        {formatRelativeShort(thread.updatedAt)}
      </span>
    </>
  )
}

export const ThemeToggle: FC = () => {
  const { theme, setTheme, systemTheme } = useTheme()
  const resolved = theme === 'system' ? systemTheme : theme
  return (
    <div className="flex items-center gap-1 rounded-lg bg-muted/40 p-0.5">
      <ThemeOption
        active={resolved === 'light'}
        onClick={() => setTheme('light')}
        label="Light"
        icon={<Sun className="size-3.5" />}
      />
      <ThemeOption
        active={resolved === 'dark'}
        onClick={() => setTheme('dark')}
        label="Dark"
        icon={<Moon className="size-3.5" />}
      />
    </div>
  )
}

const ThemeOption: FC<{
  active: boolean
  onClick: () => void
  label: string
  icon: React.ReactNode
}> = ({ active, onClick, label, icon }) => (
  <button
    type="button"
    onClick={onClick}
    aria-pressed={active}
    className={cn(
      'inline-flex h-7 flex-1 items-center justify-center gap-1.5 rounded-md text-[11.5px] transition-all',
      active
        ? 'bg-background text-foreground shadow-sm ring-1 ring-border/60'
        : 'text-muted-foreground hover:text-foreground',
    )}
  >
    {icon}
    <span>{label}</span>
  </button>
)
