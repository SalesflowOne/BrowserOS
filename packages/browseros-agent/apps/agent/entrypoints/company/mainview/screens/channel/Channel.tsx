// biome-ignore-all lint/nursery/noExcessiveLinesPerFile: screen + bubble + composer + header in one file

import { ManageChannelDialog } from '@company/components/channels/ManageChannelDialog'
import { Avatar } from '@company/components/chat/Avatar'
import { BrowserPane } from '@company/components/chat/BrowserPane'
import { TabChipRow } from '@company/components/chat/TabChipRow'
import { Button } from '@company/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from '@company/components/ui/command'
import { Input } from '@company/components/ui/input'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@company/components/ui/popover'
import { readPageIdFromText } from '@company/lib/browserosTools'
import { formatRelativeShort } from '@company/lib/relativeTime'
import type { Tint } from '@company/lib/tints'
import { cn } from '@company/lib/utils'
import {
  useAppWindow,
  useBrowserTabs,
} from '@company/modules/api/browseros.hooks'
import {
  type ChannelDetail,
  type TranscriptEntry,
  useChannel,
  useChannelEventStream,
  useChannelMessages,
  usePostChannelMessage,
  useStopChannel,
} from '@company/modules/api/channels.hooks'
import {
  type Employee,
  useEmployees,
} from '@company/modules/api/employees.hooks'
import { toastError } from '@company/modules/api/errorToast'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { Hash, Send, Settings2, Square } from 'lucide-react'
import type { FormEvent, KeyboardEvent } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { BrowserTabAttachment } from '../../../shared/attachments'

const USER_PARTICIPANT_ID = 'user'

interface Props {
  channelId: string
}

export function ChannelScreen({ channelId }: Props) {
  const channel = useChannel({ variables: { id: channelId } })
  const history = useChannelMessages({ variables: { id: channelId } })
  const stream = useChannelEventStream(channelId, history.data)
  const employees = useEmployees()
  const post = usePostChannelMessage()
  const stop = useStopChannel()
  const navigate = useNavigate()
  const search = useSearch({ strict: false }) as { browser?: 'watching' }
  const browserOpen = search.browser === 'watching'
  const isStreaming = stream.activeEmployees.size > 0
  const appWindow = useAppWindow()
  const [draft, setDraft] = useState('')
  const [resolvedTo, setResolvedTo] = useState<string | null>(null)
  const [attachments, setAttachments] = useState<BrowserTabAttachment[]>([])
  const [manageOpen, setManageOpen] = useState(false)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  const setBrowserOpen = (open: boolean) => {
    void navigate({
      to: '.',
      search: (prev) => ({
        ...prev,
        browser: open ? ('watching' as const) : undefined,
      }),
    })
  }
  const closePane = () => setBrowserOpen(false)
  const openBrowserOs = () => {
    toastError(
      new Error('Use the tray menu to show or hide the BrowserOS window.'),
      'BrowserOS visibility lives in the tray',
    )
  }

  const memberRows = useMemo(() => {
    if (!channel.data || !employees.data) return [] as Employee[]
    const lookup = new Map(employees.data.map((e) => [e.id, e]))
    return channel.data.memberIds
      .map((id) => lookup.get(id))
      .filter((e): e is Employee => Boolean(e))
  }, [channel.data, employees.data])

  // Bottom-pinning scroll. Token includes streaming-row body lengths so
  // live deltas keep the viewport pinned.
  const scrollTrigger = useMemo(() => {
    const streamingChars = stream.transcript
      .filter((e) => e.status === 'streaming')
      .reduce((sum, e) => sum + e.body.length, 0)
    return `${stream.transcript.length}:${streamingChars}`
  }, [stream.transcript])
  useEffect(() => {
    void scrollTrigger
    const node = scrollRef.current
    if (!node) return
    node.scrollTop = node.scrollHeight
  }, [scrollTrigger])

  if (!channel.data) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground text-sm">
        {channel.isLoading ? 'Loading…' : 'Channel not found.'}
      </div>
    )
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    const text = draft.trim()
    if (!text && attachments.length === 0) return
    const to =
      resolvedTo && text.includes(`@${resolvedTo}`) ? resolvedTo : undefined
    const sent = attachments
    setDraft('')
    setResolvedTo(null)
    setAttachments([])
    post.mutate(
      { id: channelId, text, to, attachments: sent },
      {
        onError: (err) => toastError(err, 'Send failed'),
      },
    )
  }

  return (
    <div
      className={cn(
        'grid h-full min-h-0',
        browserOpen
          ? 'xl:grid-cols-[minmax(0,1fr)_minmax(280px,320px)]'
          : 'xl:grid-cols-[minmax(0,1fr)]',
      )}
    >
      <div className="flex h-full min-h-0 flex-col">
        <ChannelHeader
          channel={channel.data}
          members={memberRows}
          onManage={() => setManageOpen(true)}
        />
        <ManageChannelDialog
          open={manageOpen}
          onOpenChange={setManageOpen}
          channel={channel.data}
        />
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-4">
          {stream.transcript.length === 0 &&
          stream.activeEmployees.size === 0 ? (
            <EmptyState channel={channel.data} memberRows={memberRows} />
          ) : (
            <div className="mx-auto flex max-w-3xl flex-col gap-4">
              {stream.transcript.map((entry) => (
                <TranscriptBubble
                  key={entry.id}
                  entry={entry}
                  members={memberRows}
                />
              ))}
              {[...stream.activeEmployees]
                .filter(
                  (employeeId) =>
                    !stream.transcript.some(
                      (e) =>
                        e.fromParticipantId === employeeId &&
                        e.status === 'streaming',
                    ),
                )
                .map((employeeId) => (
                  <ThinkingIndicator
                    key={employeeId}
                    employeeId={employeeId}
                    members={memberRows}
                  />
                ))}
            </div>
          )}
        </div>
        <Composer
          value={draft}
          onChange={setDraft}
          onSubmit={onSubmit}
          onMentionPick={(employeeId) => setResolvedTo(employeeId)}
          attachments={attachments}
          onAttachTab={(tab) =>
            setAttachments((prev) =>
              prev.some((p) => p.pageId === tab.pageId) ? prev : [...prev, tab],
            )
          }
          onRemoveAttachment={(pageId) =>
            setAttachments((prev) => prev.filter((p) => p.pageId !== pageId))
          }
          disabled={post.isPending}
          channelId={channelId}
          channelName={channel.data.name}
          members={memberRows}
          isStreaming={stream.activeEmployees.size > 0}
          onStop={() => {
            stop.mutate(
              { id: channelId },
              { onError: (err) => toastError(err, 'Stop failed') },
            )
          }}
        />
      </div>
      {browserOpen ? (
        <BrowserPane
          windowId={appWindow.data?.windowId ?? null}
          pageId={
            stream.activePageId ??
            deriveChannelPaneTargetPageId(stream.transcript)
          }
          streamingBlocked={isStreaming}
          onOpenBrowserOs={openBrowserOs}
          onClose={closePane}
        />
      ) : null}
    </div>
  )
}

const ChannelHeader = ({
  channel,
  members,
  onManage,
}: {
  channel: ChannelDetail
  members: Employee[]
  onManage: () => void
}) => (
  <header className="flex h-12 items-center justify-between border-border/50 border-b px-6">
    <div className="flex min-w-0 items-center gap-2 text-sm">
      <Hash className="size-4 text-muted-foreground" />
      <span className="truncate font-medium">{channel.name}</span>
      {channel.topic ? (
        <span className="truncate text-muted-foreground text-xs">
          · {channel.topic}
        </span>
      ) : null}
    </div>
    <div className="flex items-center gap-2">
      {members.length > 0 ? (
        <button
          type="button"
          onClick={onManage}
          title="Manage channel"
          className="flex items-center -space-x-1.5 rounded-md p-0.5 transition-colors hover:bg-muted/60"
        >
          {members.map((m) => (
            <div
              key={m.id}
              title={`${m.name}${m.id === channel.leadEmployeeId ? ' (lead)' : ''} · ${m.role}`}
              className="rounded-full ring-2 ring-background"
            >
              <Avatar monogram={m.monogram} tint={m.tint as Tint} size="xs" />
            </div>
          ))}
        </button>
      ) : null}
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={onManage}
        title="Manage channel"
        className="size-7 p-0"
      >
        <Settings2 className="size-3.5" />
        <span className="sr-only">Manage channel</span>
      </Button>
    </div>
  </header>
)

const EmptyState = ({
  channel,
  memberRows,
}: {
  channel: ChannelDetail
  memberRows: Employee[]
}) => {
  const lead = memberRows.find((m) => m.id === channel.leadEmployeeId)
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 pt-16 text-center text-muted-foreground text-sm">
      <p>
        <span className="text-foreground">#{channel.name}</span> is fresh.
        Untagged messages route to{' '}
        <span className="text-foreground">{lead?.name ?? 'the lead'}</span>.
      </p>
      <p className="text-xs">
        Send a message to start. You can address anyone in the channel by
        including <code>@</code> followed by their id (
        {memberRows.slice(0, 3).map((m) => (
          <code key={m.id} className="rounded bg-muted px-1 py-0.5 text-[11px]">
            @{m.id}
          </code>
        ))}
        ).
      </p>
    </div>
  )
}

const TranscriptBubble = ({
  entry,
  members,
}: {
  entry: TranscriptEntry
  members: Employee[]
}) => {
  if (entry.kind === 'system') {
    return <SystemRow body={entry.body} />
  }
  const author = resolveParticipant(entry.fromParticipantId, members)
  const audience =
    entry.toParticipantId === null
      ? null
      : resolveParticipant(entry.toParticipantId, members)
  const isUser = entry.fromParticipantId === USER_PARTICIPANT_ID
  const isStreaming = entry.status === 'streaming'
  const isError = entry.status === 'error'
  return (
    <div className="flex items-start gap-3">
      <ParticipantAvatar participant={author} size="sm" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <BubbleHeader
          author={author}
          audience={audience}
          isStreaming={isStreaming}
          isError={isError}
          ts={entry.ts}
        />
        <div
          className={cn(
            'whitespace-pre-wrap rounded-md px-3 py-2 text-sm leading-relaxed',
            isUser ? 'bg-muted/60' : 'bg-card',
            isStreaming && 'animate-pulse',
            isError && 'border border-destructive/30',
          )}
        >
          {entry.body || (isStreaming ? '…' : '')}
        </div>
      </div>
    </div>
  )
}

const SystemRow = ({ body }: { body: string }) => (
  <div className="flex items-center justify-center py-1 text-muted-foreground/80 text-xs">
    <span className="rounded-full bg-muted/40 px-3 py-1">{body}</span>
  </div>
)

const BubbleHeader = ({
  author,
  audience,
  isStreaming,
  isError,
  ts,
}: {
  author: ResolvedParticipant
  audience: ResolvedParticipant | null
  isStreaming: boolean
  isError: boolean
  ts: number
}) => (
  <div className="flex items-baseline gap-2 text-xs">
    <span className="font-medium text-foreground">{author.displayName}</span>
    {audience ? (
      <span className="text-muted-foreground">→ {audience.displayName}</span>
    ) : null}
    {isStreaming ? (
      <span className="text-muted-foreground">typing…</span>
    ) : null}
    {isError ? (
      <span className="text-destructive">errored mid-stream</span>
    ) : null}
    <span className="text-muted-foreground/60 tabular-nums">
      {formatRelativeShort(ts)}
    </span>
  </div>
)

// Shown between turn.start and the first text-delta (or instead of a
// bubble for silent turns).
const ThinkingIndicator = ({
  employeeId,
  members,
}: {
  employeeId: string
  members: Employee[]
}) => {
  const author = resolveParticipant(employeeId, members)
  return (
    <div className="flex items-start gap-3 opacity-70">
      <ParticipantAvatar participant={author} size="sm" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-baseline gap-2 text-xs">
          <span className="font-medium text-foreground">
            {author.displayName}
          </span>
          <span className="text-muted-foreground">thinking…</span>
        </div>
      </div>
    </div>
  )
}

interface ActiveMention {
  // Position of the leading `@` in the input value.
  at: number
  // The partial token typed after `@`, lower-cased.
  query: string
}

/** Returns the active mention being typed, or null. "Active" =
 *  there's an `@` after a word boundary, and the cursor sits in the
 *  run of non-whitespace chars after it. */
function detectActiveMention(
  value: string,
  cursor: number,
): ActiveMention | null {
  if (cursor <= 0) return null
  let i = cursor
  while (i > 0) {
    const ch = value.charAt(i - 1)
    if (ch === '@') {
      const before = i >= 2 ? value.charAt(i - 2) : ''
      if (i === 1 || /\s/.test(before)) {
        const query = value.slice(i, cursor).toLowerCase()
        return { at: i - 1, query }
      }
      return null
    }
    if (/\s/.test(ch)) return null
    i -= 1
  }
  return null
}

const Composer = ({
  value,
  onChange,
  onSubmit,
  onMentionPick,
  attachments,
  onAttachTab,
  onRemoveAttachment,
  disabled,
  channelId,
  channelName,
  members,
  isStreaming,
  onStop,
}: {
  value: string
  onChange: (next: string) => void
  onSubmit: (e: FormEvent) => void
  onMentionPick: (employeeId: string) => void
  attachments: BrowserTabAttachment[]
  onAttachTab: (tab: BrowserTabAttachment) => void
  onRemoveAttachment: (pageId: number) => void
  disabled: boolean
  channelId: string
  channelName: string
  members: Employee[]
  isStreaming: boolean
  onStop: () => void
}) => {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [cursor, setCursor] = useState(0)
  const active = useMemo(
    () => detectActiveMention(value, cursor),
    [value, cursor],
  )
  const memberCandidates = useMemo(() => {
    if (!active) return [] as Employee[]
    const q = active.query
    if (q.length === 0) return members
    return members.filter((m) => {
      const name = m.name.toLowerCase()
      const id = m.id.toLowerCase()
      const role = m.role.toLowerCase()
      return name.includes(q) || id.includes(q) || role.includes(q)
    })
  }, [active, members])
  const tabsQuery = useBrowserTabs({
    variables: { surface: 'channel', surfaceId: channelId },
    enabled: active !== null,
  })
  const tabCandidates = useMemo(() => {
    if (!active) return []
    const all = tabsQuery.data?.tabs ?? []
    const q = active.query.toLowerCase()
    if (q.length === 0) return all
    return all.filter(
      (t) =>
        t.title.toLowerCase().includes(q) || t.url.toLowerCase().includes(q),
    )
  }, [active, tabsQuery.data])
  const popoverOpen =
    active !== null &&
    (memberCandidates.length > 0 || tabCandidates.length > 0) &&
    !disabled

  const clearActiveToken = () => {
    if (!active) return ''
    const before = value.slice(0, active.at)
    const after = value.slice(active.at + 1 + active.query.length)
    return before + after
  }

  const insertMention = (employee: Employee) => {
    if (!active) return
    const before = value.slice(0, active.at)
    const after = value.slice(active.at + 1 + active.query.length)
    const insertion = `@${employee.id} `
    const next = before + insertion + after
    onChange(next)
    onMentionPick(employee.id)
    requestAnimationFrame(() => {
      const node = inputRef.current
      if (!node) return
      const pos = (before + insertion).length
      node.focus()
      node.setSelectionRange(pos, pos)
      setCursor(pos)
    })
  }

  const pickTab = (tab: BrowserTabAttachment) => {
    if (!active) return
    const next = clearActiveToken()
    onChange(next)
    onAttachTab(tab)
    requestAnimationFrame(() => {
      const node = inputRef.current
      if (!node) return
      const pos = active.at
      node.focus()
      node.setSelectionRange(pos, pos)
      setCursor(pos)
    })
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    // Cursor updates can lag onChange; update on arrow keys so the
    // detected mention region stays accurate.
    if (
      e.key === 'ArrowLeft' ||
      e.key === 'ArrowRight' ||
      e.key === 'Home' ||
      e.key === 'End'
    ) {
      requestAnimationFrame(() => {
        const node = inputRef.current
        if (node) setCursor(node.selectionStart ?? 0)
      })
    }
  }

  return (
    <form onSubmit={onSubmit} className="border-border/50 border-t px-6 py-4">
      <div className="mx-auto flex max-w-3xl flex-col gap-2">
        <TabChipRow
          attachments={attachments}
          onRemove={onRemoveAttachment}
          disabled={disabled || isStreaming}
        />
        <div className="flex items-end gap-2">
          <Popover open={popoverOpen}>
            <PopoverTrigger
              nativeButton={false}
              render={<div className="relative flex-1" />}
            >
              <Input
                ref={inputRef}
                value={value}
                onChange={(e) => {
                  onChange(e.target.value)
                  setCursor(e.target.selectionStart ?? e.target.value.length)
                }}
                onKeyUp={(e) =>
                  setCursor((e.target as HTMLInputElement).selectionStart ?? 0)
                }
                onKeyDown={onKeyDown}
                onClick={(e) =>
                  setCursor((e.target as HTMLInputElement).selectionStart ?? 0)
                }
                placeholder={`Message #${channelName} — type @ to address a teammate or attach a tab`}
                disabled={disabled || isStreaming}
                autoComplete="off"
              />
            </PopoverTrigger>
            <PopoverContent side="top" align="start" className="w-80 p-0">
              <Command shouldFilter={false}>
                <CommandList>
                  <CommandEmpty>No matching teammate or tab.</CommandEmpty>
                  {memberCandidates.length > 0 ? (
                    <CommandGroup heading="Channel members">
                      {memberCandidates.map((m) => (
                        <CommandItem
                          key={`m:${m.id}`}
                          value={`m:${m.id}`}
                          onSelect={() => insertMention(m)}
                        >
                          <Avatar
                            monogram={m.monogram}
                            tint={m.tint as Tint}
                            size="xs"
                            className="mr-2"
                          />
                          <div className="flex min-w-0 flex-col">
                            <span className="truncate text-sm">{m.name}</span>
                            <span className="truncate text-muted-foreground text-xs">
                              {m.role} · @{m.id}
                            </span>
                          </div>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  ) : null}
                  {tabCandidates.length > 0 ? (
                    <CommandGroup heading="Open tabs">
                      {tabCandidates.map((t) => (
                        <CommandItem
                          key={`t:${t.pageId}`}
                          value={`t:${t.pageId}`}
                          onSelect={() =>
                            pickTab({
                              kind: 'browserTab',
                              pageId: t.pageId,
                              tabId: t.tabId,
                              url: t.url,
                              title: t.title,
                            })
                          }
                        >
                          <div className="flex min-w-0 flex-col">
                            <span className="truncate text-sm">
                              {t.title || t.url}
                            </span>
                            <span className="truncate text-muted-foreground text-xs">
                              {t.url.replace(/^https?:\/\//, '')}
                            </span>
                          </div>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  ) : null}
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
          {isStreaming ? (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={onStop}
              disabled={disabled}
            >
              <Square className="mr-1.5 size-3.5" />
              Stop
            </Button>
          ) : (
            <Button
              type="submit"
              size="sm"
              disabled={disabled || (!value.trim() && attachments.length === 0)}
            >
              <Send className="mr-1.5 size-3.5" />
              Send
            </Button>
          )}
        </div>
      </div>
    </form>
  )
}

// Cold-server fallback for when `meta.active-page-id` is unavailable
// (server restarted between turns). Scans newest-first for a
// prose-form pageId in persisted message bodies.
function deriveChannelPaneTargetPageId(
  transcript: TranscriptEntry[],
): number | null {
  for (let i = transcript.length - 1; i >= 0; i--) {
    const entry = transcript[i]
    if (!entry || entry.kind === 'system') continue
    const found = readPageIdFromText(entry.body)
    if (found !== null) return found
  }
  return null
}

interface ResolvedParticipant {
  id: string
  displayName: string
  monogram: string
  tint: Tint
}

const USER_PARTICIPANT: ResolvedParticipant = {
  id: USER_PARTICIPANT_ID,
  displayName: 'user',
  monogram: 'U',
  tint: 'blue',
}

const UNKNOWN_TINT: Tint = 'orange'

function resolveParticipant(
  id: string,
  members: Employee[],
): ResolvedParticipant {
  if (id === USER_PARTICIPANT_ID) return USER_PARTICIPANT
  const row = members.find((m) => m.id === id)
  if (!row) {
    return {
      id,
      displayName: id,
      monogram: id.slice(0, 2).toUpperCase(),
      tint: UNKNOWN_TINT,
    }
  }
  return {
    id: row.id,
    displayName: row.name,
    monogram: row.monogram,
    tint: row.tint as Tint,
  }
}

const ParticipantAvatar = ({
  participant,
  size,
}: {
  participant: ResolvedParticipant
  size: 'xs' | 'sm' | 'md' | 'lg'
}) =>
  participant.id === USER_PARTICIPANT_ID ? (
    <div
      className={cn(
        'flex shrink-0 items-center justify-center rounded-full bg-muted font-medium text-[10.5px] text-muted-foreground',
        size === 'sm' ? 'size-7' : size === 'md' ? 'size-9' : 'size-5',
      )}
    >
      You
    </div>
  ) : (
    <Avatar
      monogram={participant.monogram}
      tint={participant.tint}
      size={size}
      className="shrink-0"
    />
  )
