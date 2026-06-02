import { Button } from '@company/components/ui/button'
import { toastError } from '@company/modules/api/errorToast'
import {
  useCheckBrowserosMcp,
  useSystemSettings,
} from '@company/modules/api/system.hooks'
import { Check, CircleAlert, Loader2, RefreshCw } from 'lucide-react'
import { useEffect } from 'react'
import { toast } from 'sonner'

// The company domain runs inside the BrowserOS server binary, so the browser
// tools' MCP endpoint is the server's own /mcp on the same port — resolved
// automatically by the backend (see settings/browseros.ts setOwnServerMcpUrl).
// This section is read-only: it shows the detected endpoint + reachability,
// with no port to configure.
export function BrowserosSection() {
  const settings = useSystemSettings()
  const check = useCheckBrowserosMcp()
  const browserosMcpUrl = settings.data?.browserosMcpUrl ?? ''

  useEffect(() => {
    if (!browserosMcpUrl) return
    check.mutate({ browserosMcpUrl })
  }, [browserosMcpUrl, check.mutate])

  const checkError = check.error instanceof Error ? check.error.message : null

  const onCheck = async () => {
    if (!browserosMcpUrl) return
    try {
      const result = await check.mutateAsync({ browserosMcpUrl })
      if (result.status === 'reachable') {
        toast.success(
          `BrowserOS reachable — ${result.toolCount} tool${result.toolCount === 1 ? '' : 's'} available`,
        )
      } else {
        toast.error(result.error ?? 'BrowserOS is unreachable')
      }
    } catch (err) {
      toastError(err, 'Could not check BrowserOS')
    }
  }

  return (
    <section className="rounded-lg border border-border/70 bg-card/40">
      <div className="flex items-start justify-between gap-3 border-border/60 border-b px-4 py-3">
        <div className="min-w-0">
          <h2 className="font-medium text-[15px]">BrowserOS</h2>
          <p className="mt-1 text-muted-foreground text-sm">
            Browser tools run in the BrowserOS server this app is part of — the
            MCP endpoint is detected automatically.
          </p>
        </div>
        <BrowserosStatus loading={check.isPending} status={check.data?.status} />
      </div>

      <div className="space-y-3 p-4">
        <div className="space-y-2">
          <p className="font-medium text-sm">MCP endpoint</p>
          <div className="rounded-md border border-border/60 bg-muted/40 px-3 py-2 font-mono text-muted-foreground text-sm">
            {browserosMcpUrl ||
              (settings.isLoading ? 'Detecting…' : 'Unavailable')}
          </div>
        </div>

        {settings.error ? (
          <p className="text-destructive text-sm">Could not load settings.</p>
        ) : null}
        {checkError ? (
          <p className="text-destructive text-sm">{checkError}</p>
        ) : null}
        {check.data?.error ? (
          <p className="text-destructive text-sm">{check.data.error}</p>
        ) : null}
      </div>

      <div className="flex items-center justify-end gap-2 border-border/60 border-t px-4 py-3">
        <Button
          type="button"
          variant="outline"
          onClick={onCheck}
          disabled={settings.isLoading || check.isPending || !browserosMcpUrl}
        >
          {check.isPending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <RefreshCw className="size-4" />
          )}
          Check
        </Button>
      </div>
    </section>
  )
}

const BrowserosStatus = ({
  loading,
  status,
}: {
  loading: boolean
  status?: 'reachable' | 'unreachable'
}) => {
  if (loading) {
    return (
      <span className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border/70 px-2 py-1 text-muted-foreground text-xs">
        <Loader2 className="size-3 animate-spin" />
        Checking
      </span>
    )
  }
  if (status === 'reachable') {
    return (
      <span className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-[color:var(--accent-orange)]/30 bg-[color:var(--accent-orange)]/10 px-2 py-1 text-[color:var(--accent-orange)] text-xs">
        <Check className="size-3" />
        Connected
      </span>
    )
  }
  if (status === 'unreachable') {
    return (
      <span className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1 text-destructive text-xs">
        <CircleAlert className="size-3" />
        Unavailable
      </span>
    )
  }
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border/70 px-2 py-1 text-muted-foreground text-xs">
      Not checked
    </span>
  )
}
