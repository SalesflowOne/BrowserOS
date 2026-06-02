import { Avatar } from '@company/components/chat/Avatar'
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@company/components/ui/command'
import {
  formatAbsoluteDateTime,
  formatRelativeLong,
} from '@company/lib/dateTime'
import * as signal from '@company/lib/searchPaletteSignal'
import type { Tint } from '@company/lib/tints'
import {
  type Employee,
  type RecentThread,
  useEmployees,
  useEmployeesWithRecentThreads,
} from '@company/modules/api/employees.hooks'
import {
  type SearchResults,
  useSearch,
} from '@company/modules/api/search.hooks'
import { useNavigate } from '@tanstack/react-router'
import { type FC, useEffect, useState } from 'react'
import { Snippet } from './Snippet'

type Recent = RecentThread & { employeeId: string }
type Go = (employeeId: string, threadId: string, messageId?: string) => void
type FindEmployee = (id: string) => Employee | undefined

// Floating Cmd+K search dialog. Sits in the app shell once and reacts
// to the searchPaletteSignal — so both the rail's Search button and
// the global Cmd+K handler dispatch through the same channel.
//
// Empty query → recent threads. Query < 2 chars → "keep typing". Query
// ≥ 2 → debounced /search call grouped by Threads + Messages.
export const SearchPalette: FC = () => {
  const [isOpen, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const navigate = useNavigate()
  const { data, isFetching } = useSearch(query)
  const employeesWithRecent = useEmployeesWithRecentThreads({
    variables: { limit: 3 },
  })
  const employees = useEmployees()

  // Flatten across employees and re-sort by most-recent. The rail's
  // existing query already returns per-employee recents ordered by
  // updatedAt — we just merge the heads.
  const recentThreads: Recent[] = (employeesWithRecent.data ?? [])
    .flatMap((emp) =>
      emp.recentThreads.map((t) => ({ ...t, employeeId: emp.id })),
    )
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 5)

  useEffect(() => signal.subscribe(setOpen), [])
  useEffect(() => {
    // Reset the input on close so the next open starts clean. Cheap;
    // the recent-threads query is cached.
    if (!isOpen) setQuery('')
  }, [isOpen])

  const findEmployee: FindEmployee = (id) =>
    employees.data?.find((e) => e.id === id)

  const goToThread: Go = (employeeId, threadId, messageId) => {
    void navigate({
      to: '/e/$employeeId/t/$threadId',
      params: { employeeId, threadId },
      search: messageId ? { msg: messageId } : {},
    })
    signal.close()
  }

  const trimmed = query.trim()
  return (
    <CommandDialog
      open={isOpen}
      onOpenChange={(v) => (v ? signal.open() : signal.close())}
      title="Search"
      description="Search threads and messages"
      // Spotlight-like proportions: 640px max width (vs the default
      // sm:max-w-lg = 512px), generous content area. `gap-0 p-0` on
      // DialogContent overrides shadcn's default padding so the
      // CommandInput sits flush at the top.
      className="!max-w-[640px] !w-[640px] gap-0 p-0"
    >
      {/* Wrap in <Command> so cmdk's child primitives find their
          root context. shouldFilter={false}: server-side LIKE
          already filtered; cmdk's client-side fuzzy filter would
          otherwise hide every row whose `value` doesn't fuzzy-match
          the input. cmdk still uses `value` for arrow-key identity
          + selection. */}
      <Command shouldFilter={false} className="border-none">
        <CommandInput
          value={query}
          onValueChange={setQuery}
          placeholder="Search threads + messages…"
          className="!h-12 !text-[15px]"
        />
        <CommandList className="!max-h-[440px] !min-h-[120px]">
          <Body
            query={trimmed}
            data={data}
            isFetching={isFetching}
            recent={recentThreads}
            findEmployee={findEmployee}
            goToThread={goToThread}
          />
        </CommandList>
        <KeyboardHints />
      </Command>
    </CommandDialog>
  )
}

const KeyboardHints: FC = () => (
  <div className="flex items-center justify-end gap-3 border-border/40 border-t px-3 py-2 text-[10.5px] text-muted-foreground/70">
    <span className="flex items-center gap-1">
      <kbd className="rounded border border-border/60 bg-muted px-1 py-px font-mono text-[10px]">
        ↵
      </kbd>
      <span>open</span>
    </span>
    <span className="flex items-center gap-1">
      <kbd className="rounded border border-border/60 bg-muted px-1 py-px font-mono text-[10px]">
        ↑↓
      </kbd>
      <span>navigate</span>
    </span>
    <span className="flex items-center gap-1">
      <kbd className="rounded border border-border/60 bg-muted px-1 py-px font-mono text-[10px]">
        esc
      </kbd>
      <span>close</span>
    </span>
  </div>
)

const Body: FC<{
  query: string
  data: SearchResults | undefined
  isFetching: boolean
  recent: Recent[]
  findEmployee: FindEmployee
  goToThread: Go
}> = ({ query, data, isFetching, recent, findEmployee, goToThread }) => {
  if (query.length === 0) {
    return (
      <RecentSection
        recent={recent}
        findEmployee={findEmployee}
        goToThread={goToThread}
      />
    )
  }
  if (query.length < 2) {
    return <CommandEmpty>Keep typing — at least 2 characters</CommandEmpty>
  }
  const hasResults =
    !!data && (data.threads.length > 0 || data.messages.length > 0)
  // Two cases reach this branch:
  //   (a) data is undefined and isFetching — the very first query
  //       at ≥ 2 chars before any response has landed. Show
  //       "Searching…" instead of "No results" so the empty state
  //       doesn't flicker.
  //   (b) data is empty AND not fetching — the query genuinely has
  //       no matches. Show the proper "no results" copy.
  // placeholderData on the hook keeps subsequent in-flight queries
  // on the previous data, so this isFetching branch only fires for
  // the FIRST query of a session.
  if (!hasResults) {
    if (isFetching) {
      return <CommandEmpty>Searching…</CommandEmpty>
    }
    return (
      <CommandEmpty>
        No results for "{query}". Try a shorter or simpler search term.
      </CommandEmpty>
    )
  }
  return (
    <ResultsSection
      query={query}
      data={data}
      findEmployee={findEmployee}
      goToThread={goToThread}
    />
  )
}

// Shared row chrome: avatar + main content slot + right-aligned
// times. Used by every result kind (recent, thread match, message
// match) so the rows align visually no matter which group.
const Row: FC<{
  employee: Employee | undefined
  ts: number
  children: React.ReactNode
}> = ({ employee, ts, children }) => (
  <div className="flex w-full items-start gap-3">
    {employee ? (
      <Avatar
        monogram={employee.monogram}
        tint={employee.tint as Tint}
        size="sm"
      />
    ) : (
      <span className="size-7 shrink-0 rounded-full bg-muted" />
    )}
    <div className="flex min-w-0 flex-1 flex-col gap-0.5">{children}</div>
    <div className="flex shrink-0 flex-col items-end gap-0.5 text-[10px] text-muted-foreground/70 tabular-nums">
      <span>{formatRelativeLong(ts)}</span>
      <span className="text-muted-foreground/50">
        {formatAbsoluteDateTime(ts)}
      </span>
    </div>
  </div>
)

// "Sam, Software Engineer" formatter. Falls back to "Agent" when we
// can't look the employee up yet (employees query loading on first
// open). Comma reads better than the dot we had before — the user
// flagged the "you · Sam" awkwardness explicitly.
function agentLabel(employee: Employee | undefined): string {
  if (!employee) return 'Agent'
  return employee.role ? `${employee.name}, ${employee.role}` : employee.name
}

const RecentSection: FC<{
  recent: Recent[]
  findEmployee: FindEmployee
  goToThread: Go
}> = ({ recent, findEmployee, goToThread }) => (
  <CommandGroup heading="Recent threads">
    {recent.map((t) => {
      const employee = findEmployee(t.employeeId)
      return (
        <CommandItem
          key={t.id}
          // `value` is what cmdk uses for arrow-key identity. With
          // shouldFilter off it doesn't drive matching, just selection.
          value={`recent:${t.id}`}
          onSelect={() => goToThread(t.employeeId, t.id)}
          className="px-3 py-2.5"
        >
          <Row employee={employee} ts={t.updatedAt}>
            <span className="truncate font-medium text-sm">{t.title}</span>
            <span className="text-[11px] text-muted-foreground">
              {agentLabel(employee)}
            </span>
          </Row>
        </CommandItem>
      )
    })}
  </CommandGroup>
)

const ResultsSection: FC<{
  query: string
  data: SearchResults
  findEmployee: FindEmployee
  goToThread: Go
}> = ({ query, data, findEmployee, goToThread }) => (
  <>
    {data.threads.length > 0 ? (
      <CommandGroup heading="Threads">
        {data.threads.map((t) => {
          const employee = findEmployee(t.employeeId)
          return (
            <CommandItem
              key={t.id}
              value={`thread:${t.id}`}
              onSelect={() => goToThread(t.employeeId, t.id)}
              className="px-3 py-2.5"
            >
              <Row employee={employee} ts={t.updatedAt}>
                <Snippet
                  text={t.title}
                  query={query}
                  windowSize={80}
                  className="truncate font-medium text-sm"
                />
                <span className="text-[11px] text-muted-foreground">
                  {agentLabel(employee)} · title match
                </span>
              </Row>
            </CommandItem>
          )
        })}
      </CommandGroup>
    ) : null}
    {data.messages.length > 0 ? (
      <CommandGroup heading="Messages">
        {data.messages.map((m) => {
          const employee = findEmployee(m.employeeId)
          return (
            <CommandItem
              key={m.id}
              value={`msg:${m.id}`}
              onSelect={() =>
                goToThread(m.employeeId, m.threadId, m.turnRequestId)
              }
              className="px-3 py-2.5"
            >
              <Row employee={employee} ts={m.createdAt}>
                {/* Thread title is the row's anchor — tells the user
                    which conversation this match lives in. */}
                <span className="truncate font-medium text-sm">
                  {m.threadTitle}
                </span>
                <Snippet
                  text={m.body ?? ''}
                  query={query}
                  windowSize={140}
                  className="line-clamp-2 text-[12px] text-muted-foreground"
                />
                <span className="text-[11px] text-muted-foreground/80">
                  {agentLabel(employee)}
                </span>
              </Row>
            </CommandItem>
          )
        })}
      </CommandGroup>
    ) : null}
  </>
)
