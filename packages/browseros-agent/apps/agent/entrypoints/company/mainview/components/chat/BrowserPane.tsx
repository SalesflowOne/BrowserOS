import { cn } from '@company/lib/utils'
import {
  type ScreencastStatus,
  useScreencast,
} from '@company/modules/screencast/useScreencast'
import { ExternalLink, X } from 'lucide-react'
import { type FC, useRef } from 'react'

export interface BrowserPaneProps {
  windowId: number | null
  pageId: number | null
  streamingBlocked: boolean
  onOpenBrowserOs: () => void
  onClose: () => void
}

export const BrowserPane: FC<BrowserPaneProps> = ({
  windowId,
  pageId,
  streamingBlocked,
  onOpenBrowserOs,
  onClose,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const { status, currentUrl } = useScreencast(windowId, pageId, canvasRef)
  const hostname = hostnameOf(currentUrl)
  const ctaDisabled = streamingBlocked

  return (
    <aside className="hidden h-full min-h-0 flex-col overflow-hidden border-border/50 border-l bg-card/30 xl:flex">
      <header className="flex h-12 shrink-0 items-center gap-2 border-border/50 border-b px-3">
        <StatusDot status={status} />
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground/80">
          {hostname ?? labelFor(status, windowId, pageId)}
        </span>
        <button
          type="button"
          onClick={onOpenBrowserOs}
          disabled={ctaDisabled}
          title={
            ctaDisabled
              ? 'Wait for the current task to finish before opening BrowserOS'
              : 'Show this browser window in BrowserOS'
          }
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
        >
          Open in BrowserOS
          <ExternalLink className="size-3" />
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close browser pane"
          className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-accent hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
      </header>

      {streamingBlocked ? (
        <div className="shrink-0 border-border/50 border-b bg-amber-500/5 px-3 py-1.5 text-[11px] text-amber-700 dark:text-amber-300">
          Agent is still running — open in BrowserOS will be enabled once the
          turn finishes.
        </div>
      ) : null}

      <div className="relative min-h-0 flex-1 overflow-hidden bg-black/90">
        <canvas
          ref={canvasRef}
          className="absolute inset-0 m-auto block max-h-full max-w-full"
        />
        <Overlay status={status} windowId={windowId} pageId={pageId} />
      </div>
    </aside>
  )
}

const Overlay: FC<{
  status: ScreencastStatus
  windowId: number | null
  pageId: number | null
}> = ({ status, windowId, pageId }) => {
  if (windowId === null) {
    return <OverlayText>Waiting for browser activity…</OverlayText>
  }
  if (status === 'idle' && pageId === null) {
    return <OverlayText>No browser activity yet</OverlayText>
  }
  if (status === 'connecting') return <OverlayText>Connecting…</OverlayText>
  if (status === 'reconnecting') return <OverlayText>Reconnecting…</OverlayText>
  if (status === 'closed') return <OverlayText>Disconnected</OverlayText>
  return null
}

const OverlayText: FC<{ children: string }> = ({ children }) => (
  <div className="absolute inset-0 flex items-center justify-center bg-black/40 text-white/80 text-xs">
    {children}
  </div>
)

const StatusDot: FC<{ status: ScreencastStatus }> = ({ status }) => (
  <span
    aria-hidden
    className={cn(
      'inline-block size-1.5 rounded-full',
      status === 'live'
        ? 'bg-emerald-500'
        : status === 'connecting' || status === 'reconnecting'
          ? 'bg-amber-500'
          : 'bg-muted-foreground/40',
    )}
  />
)

function labelFor(
  status: ScreencastStatus,
  windowId: number | null,
  pageId: number | null,
): string {
  if (windowId === null) return 'No browser activity yet'
  if (status === 'idle' && pageId === null) return 'No browser activity yet'
  switch (status) {
    case 'connecting':
      return 'Connecting…'
    case 'live':
      return 'Live'
    case 'reconnecting':
      return 'Reconnecting…'
    case 'closed':
      return 'Disconnected'
    default:
      return 'Browser'
  }
}

function hostnameOf(url: string | null): string | null {
  if (!url) return null
  try {
    return new URL(url).hostname || url
  } catch {
    return url
  }
}
