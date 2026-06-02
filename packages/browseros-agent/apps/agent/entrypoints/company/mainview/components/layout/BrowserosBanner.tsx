import { useBrowserosStatus } from '@company/modules/api/system.hooks'
import { Link } from '@tanstack/react-router'
import { Loader2, RefreshCw, TriangleAlert } from 'lucide-react'
import type { FC } from 'react'

// M1 done-bar requires a clear banner when BrowserOS isn't running, and
// for it to clear within 30s of BrowserOS coming back up. The hook polls
// every 15s, so the banner reacts well inside that window.
export const BrowserosBanner: FC = () => {
  const status = useBrowserosStatus()

  // Hide only while we genuinely don't know yet (initial fetch). If the
  // status endpoint errors persistently we still want the banner — falling
  // back to "unreachable" framing is the safer signal than going silent.
  if (status.isPending) return null
  if (status.data?.status === 'reachable') return null

  const isRefetching = status.isFetching
  return (
    <div className="shrink-0 border-amber-500/30 border-b bg-amber-500/10">
      <div className="flex items-center gap-3 px-6 py-2 text-amber-900 text-sm dark:text-amber-200">
        <TriangleAlert className="size-4 shrink-0" />
        <div className="min-w-0 flex-1">
          <span className="font-medium">BrowserOS isn’t reachable.</span>{' '}
          <span className="text-amber-900/80 dark:text-amber-200/80">
            Agents can chat, but tools that need the browser or connectors will
            fail until it’s running.
          </span>
        </div>
        <button
          type="button"
          onClick={() => status.refetch()}
          disabled={isRefetching}
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 font-medium text-amber-900 text-xs hover:bg-amber-500/15 disabled:opacity-60 dark:text-amber-200"
        >
          {isRefetching ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <RefreshCw className="size-3.5" />
          )}
          Retry now
        </button>
        <Link
          to="/settings"
          className="inline-flex items-center rounded-md px-2 py-1 font-medium text-amber-900 text-xs hover:bg-amber-500/15 dark:text-amber-200"
        >
          Open settings
        </Link>
      </div>
    </div>
  )
}
