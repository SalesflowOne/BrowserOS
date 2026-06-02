import { Button } from '@company/components/ui/button'
import { Input } from '@company/components/ui/input'
import { Label } from '@company/components/ui/label'
import { toastError } from '@company/modules/api/errorToast'
import {
  useCheckBrowserosMcp,
  useSystemSettings,
  useUpdateSystemSettings,
} from '@company/modules/api/system.hooks'
import {
  Check,
  CircleAlert,
  Loader2,
  RefreshCw,
  RotateCcw,
  Save,
} from 'lucide-react'
import { type FormEvent, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'

export function BrowserosSection() {
  const settings = useSystemSettings()
  const update = useUpdateSystemSettings()
  const check = useCheckBrowserosMcp()
  const [browserosMcpUrl, setBrowserosMcpUrl] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (settings.data) setBrowserosMcpUrl(settings.data.browserosMcpUrl)
  }, [settings.data])

  useEffect(() => {
    if (!settings.data?.browserosMcpUrl) return
    check.mutate({ browserosMcpUrl: settings.data.browserosMcpUrl })
  }, [settings.data?.browserosMcpUrl, check.mutate])

  const dirty = useMemo(
    () => settings.data?.browserosMcpUrl !== browserosMcpUrl,
    [browserosMcpUrl, settings.data?.browserosMcpUrl],
  )
  const updateError =
    update.error instanceof Error ? update.error.message : null
  const checkError = check.error instanceof Error ? check.error.message : null

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSaved(false)
    try {
      const next = await update.mutateAsync({ browserosMcpUrl })
      setBrowserosMcpUrl(next.browserosMcpUrl)
      setSaved(true)
      check.mutate({ browserosMcpUrl: next.browserosMcpUrl })
    } catch (err) {
      toastError(err, 'Could not save settings')
    }
  }

  const onCheck = async () => {
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

  const reset = () => {
    if (settings.data) setBrowserosMcpUrl(settings.data.browserosMcpUrl)
    setSaved(false)
  }

  return (
    <form onSubmit={onSubmit}>
      <section className="rounded-lg border border-border/70 bg-card/40">
        <div className="flex items-start justify-between gap-3 border-border/60 border-b px-4 py-3">
          <div className="min-w-0">
            <h2 className="font-medium text-[15px]">BrowserOS</h2>
            <p className="mt-1 text-muted-foreground text-sm">
              MCP endpoint used by BrowserOS tools and connectors.
            </p>
          </div>
          <BrowserosStatus
            loading={check.isPending}
            status={check.data?.status}
          />
        </div>

        <div className="space-y-3 p-4">
          <div className="space-y-2">
            <Label htmlFor="browseros-mcp-url">MCP URL</Label>
            <Input
              id="browseros-mcp-url"
              value={browserosMcpUrl}
              onChange={(event) => {
                setBrowserosMcpUrl(event.target.value)
                setSaved(false)
              }}
              placeholder="http://127.0.0.1:9200/mcp"
              spellCheck={false}
              disabled={settings.isLoading || update.isPending}
            />
          </div>

          {settings.error ? (
            <p className="text-destructive text-sm">Could not load settings.</p>
          ) : null}
          {updateError ? (
            <p className="text-destructive text-sm">{updateError}</p>
          ) : null}
          {checkError ? (
            <p className="text-destructive text-sm">{checkError}</p>
          ) : null}
          {check.data?.error ? (
            <p className="text-destructive text-sm">{check.data.error}</p>
          ) : null}
          {saved ? (
            <p className="inline-flex items-center gap-1.5 text-[color:var(--accent-orange)] text-sm">
              <Check className="size-3.5" />
              Saved
            </p>
          ) : null}
        </div>

        <div className="flex items-center justify-end gap-2 border-border/60 border-t px-4 py-3">
          <Button
            type="button"
            variant="outline"
            onClick={onCheck}
            disabled={settings.isLoading || check.isPending}
          >
            {check.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RefreshCw className="size-4" />
            )}
            Check
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={reset}
            disabled={!dirty || update.isPending}
          >
            <RotateCcw className="size-4" />
            Reset
          </Button>
          <Button type="submit" disabled={!dirty || update.isPending}>
            <Save className="size-4" />
            {update.isPending ? 'Saving' : 'Save'}
          </Button>
        </div>
      </section>
    </form>
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
