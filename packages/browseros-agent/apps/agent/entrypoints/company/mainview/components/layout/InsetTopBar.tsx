import { Avatar } from '@company/components/chat/Avatar'
import { SidebarTrigger, useSidebar } from '@company/components/ui/sidebar'
import type { Tint } from '@company/lib/tints'
import type { Status } from '@company/lib/types'
import { cn } from '@company/lib/utils'
import { useEmployee } from '@company/modules/api/employees.hooks'
import { useThread } from '@company/modules/api/threads.hooks'
import {
  useCanGoBack,
  useNavigate,
  useParams,
  useRouter,
  useRouterState,
  useSearch,
} from '@tanstack/react-router'
import { ChevronLeft, ChevronRight, Info, Monitor } from 'lucide-react'
import type { ButtonHTMLAttributes, FC } from 'react'

// Layout (left → right):
//   [pl-20 if collapsed]  ◰  ◀  ▶   (●) Researcher · subtitle   …drag…   ⓘ
//
// The BrowserClaw wordmark lives in the sidebar's header (Shell.tsx)
// so it shares the traffic-light row with the rail. The chat context
// (avatar + name + thread subtitle) sits immediately to the right of
// back/forward, and the info toggle floats on the far right.
export const InsetTopBar: FC = () => {
  const router = useRouter()
  const canBack = useCanGoBack()
  const { state } = useSidebar()
  const collapsed = state === 'collapsed'

  return (
    <div
      className={cn(
        'app-region-drag flex h-9 shrink-0 items-center gap-1 border-border/50 border-b px-2',
        collapsed && 'darwin:pl-20',
      )}
    >
      <SidebarTrigger className="app-region-no-drag size-7 text-muted-foreground/70 hover:text-foreground" />
      <ChromeButton
        onClick={() => router.history.back()}
        disabled={!canBack}
        aria-label="Back"
        title="Back"
      >
        <ChevronLeft className="size-3.5" />
      </ChromeButton>
      <ChromeButton
        onClick={() => router.history.go(1)}
        aria-label="Forward"
        title="Forward"
      >
        <ChevronRight className="size-3.5" />
      </ChromeButton>
      <ThreadContext />
      <div className="flex-1" />
      <BrowserPaneToggle />
      <ThreadInfoButton />
    </div>
  )
}

const BrowserPaneToggle: FC = () => {
  const params = useParams({ strict: false }) as {
    employeeId?: string
    threadId?: string
    channelId?: string
  }
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  const navigate = useNavigate()
  const search = useSearch({ strict: false }) as { browser?: 'watching' }
  const isOpen = search.browser === 'watching'

  const isChat =
    (params.threadId !== undefined && params.threadId !== 'general') ||
    params.channelId !== undefined
  const isNewThread = params.employeeId && pathname.endsWith('/new')
  if (!isChat || isNewThread) return null

  const onToggle = () => {
    void navigate({
      to: '.',
      search: (prev) => ({
        ...prev,
        browser: isOpen ? undefined : ('watching' as const),
      }),
    })
  }

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={isOpen}
      title={isOpen ? 'Hide browser pane' : 'Show browser pane'}
      className={cn(
        'app-region-no-drag inline-flex size-6 shrink-0 items-center justify-center rounded transition-colors',
        isOpen
          ? 'bg-[color:var(--accent-orange)]/10 text-[color:var(--accent-orange)]'
          : 'text-muted-foreground/70 hover:bg-accent hover:text-foreground',
      )}
    >
      <Monitor className="size-3.5" />
    </button>
  )
}

// Reads route params directly so the shell stays oblivious to whether
// we're on a thread route or not. On non-thread routes both queries
// are disabled and the cluster collapses to nothing.
const ThreadContext: FC = () => {
  const params = useParams({ strict: false }) as {
    employeeId?: string
    threadId?: string
  }
  const search = useSearch({ strict: false }) as { details?: 'open' }
  const navigate = useNavigate()
  const detailsOpen = search.details === 'open'

  const employee = useEmployee({
    variables: { id: params.employeeId ?? '' },
    enabled: Boolean(params.employeeId),
  })
  const thread = useThread({
    variables: { id: params.threadId ?? '' },
    enabled: Boolean(params.threadId) && params.threadId !== 'general',
  })

  if (!employee.data || !thread.data) return null

  const subtitle = thread.data.isGeneral
    ? (employee.data.tagline ?? employee.data.role)
    : thread.data.title

  const toggleDetails = () => {
    void navigate({
      to: '.',
      search: () => ({ details: detailsOpen ? undefined : ('open' as const) }),
    })
  }

  return (
    <button
      type="button"
      onClick={toggleDetails}
      title={detailsOpen ? 'Hide profile' : 'Show profile'}
      className="app-region-no-drag ml-1 flex min-w-0 max-w-[44ch] items-center gap-2 rounded-md px-1.5 py-0.5 text-left transition-colors hover:bg-accent/40"
    >
      <Avatar
        monogram={employee.data.monogram}
        tint={employee.data.tint as Tint}
        status={employee.data.status as Status}
        size="xs"
      />
      <span className="flex min-w-0 items-center gap-1.5 text-[12px]">
        <span className="truncate font-medium text-foreground">
          {employee.data.name}
        </span>
        <span aria-hidden className="text-muted-foreground/40">
          ·
        </span>
        <span className="truncate text-muted-foreground">{subtitle}</span>
      </span>
    </button>
  )
}

const ThreadInfoButton: FC = () => {
  const params = useParams({ strict: false }) as {
    employeeId?: string
    threadId?: string
  }
  const search = useSearch({ strict: false }) as { details?: 'open' }
  const navigate = useNavigate()

  if (!params.employeeId || !params.threadId) return null

  const detailsOpen = search.details === 'open'
  const toggleDetails = () => {
    void navigate({
      to: '.',
      search: () => ({ details: detailsOpen ? undefined : ('open' as const) }),
    })
  }

  return (
    <button
      type="button"
      onClick={toggleDetails}
      aria-pressed={detailsOpen}
      title={detailsOpen ? 'Hide profile' : 'Show profile'}
      className={cn(
        'app-region-no-drag inline-flex size-6 shrink-0 items-center justify-center rounded transition-colors',
        detailsOpen
          ? 'bg-[color:var(--accent-orange)]/10 text-[color:var(--accent-orange)]'
          : 'text-muted-foreground/70 hover:bg-accent hover:text-foreground',
      )}
    >
      <Info className="size-3.5" />
    </button>
  )
}

const ChromeButton: FC<ButtonHTMLAttributes<HTMLButtonElement>> = ({
  className,
  children,
  ...props
}) => (
  <button
    type="button"
    className={cn(
      'app-region-no-drag inline-flex size-6 items-center justify-center rounded text-muted-foreground/70 transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-30',
      className,
    )}
    {...props}
  >
    {children}
  </button>
)
