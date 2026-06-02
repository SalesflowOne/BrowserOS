import { cn } from '@company/lib/utils'
import { Link, Outlet, useRouterState } from '@tanstack/react-router'
import { ServerCog } from 'lucide-react'

interface TabDef {
  to: '/settings' | '/settings/mcp' | '/settings/skills' | '/settings/telegram'
  label: string
  match: (pathname: string) => boolean
}

const TABS: TabDef[] = [
  {
    to: '/settings',
    label: 'General',
    match: (pathname) => pathname === '/settings' || pathname === '/settings/',
  },
  {
    to: '/settings/mcp',
    label: 'MCP',
    match: (pathname) => pathname.startsWith('/settings/mcp'),
  },
  {
    to: '/settings/skills',
    label: 'Skills',
    match: (pathname) => pathname.startsWith('/settings/skills'),
  },
  {
    to: '/settings/telegram',
    label: 'Telegram',
    match: (pathname) => pathname.startsWith('/settings/telegram'),
  },
]

export function SettingsLayout() {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <header className="border-border/60 border-b px-6 pt-5">
        <div className="flex items-center gap-3 pb-5">
          <span className="inline-flex size-9 items-center justify-center rounded-md bg-[color:var(--accent-orange)]/10 text-[color:var(--accent-orange)]">
            <ServerCog className="size-4" />
          </span>
          <div className="min-w-0">
            <h1 className="font-semibold text-xl tracking-tight">Settings</h1>
            <p className="mt-1 text-muted-foreground text-sm">
              App-level configuration for local agent runtime dependencies.
            </p>
          </div>
        </div>
        <nav className="-mb-px flex gap-4">
          {TABS.map((tab) => {
            const active = tab.match(pathname)
            return (
              <Link
                key={tab.to}
                to={tab.to}
                className={cn(
                  'border-b-2 px-1 pb-2.5 text-sm transition-colors',
                  active
                    ? 'border-[color:var(--accent-orange)] font-medium text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground',
                )}
              >
                {tab.label}
              </Link>
            )
          })}
        </nav>
      </header>
      <Outlet />
    </div>
  )
}
