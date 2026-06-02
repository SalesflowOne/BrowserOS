import { Button } from '@company/components/ui/button'
import { toastError } from '@company/modules/api/errorToast'
import {
  useConnectToolkit,
  useSubmitToolkitApiKey,
} from '@company/modules/api/mcpConnections.hooks'
import { useSendThreadMessage } from '@company/modules/api/threads.hooks'
import { Check, ExternalLink, Plug } from 'lucide-react'
import { type FC, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { ApiKeyDialog } from './ApiKeyDialog'
import { ExternalLinkDialog } from './ExternalLinkDialog'

type CardPhase = 'choosing' | 'oauth-pending' | 'resolved'

interface Props {
  threadId: string
  toolkit: string
  reason: string
  // Cards rendered in scrollback (not the live turn) snap straight to
  // 'resolved' — re-clicking Connect on an old card would re-trigger
  // the whole flow against a stale nudge.
  isLastTurn: boolean
}

export const ConnectAppCard: FC<Props> = ({
  threadId,
  toolkit,
  reason,
  isLastTurn,
}) => {
  const [phase, setPhase] = useState<CardPhase>(
    isLastTurn ? 'choosing' : 'resolved',
  )
  const [oauthUrl, setOauthUrl] = useState<string | null>(null)
  const [popupOpen, setPopupOpen] = useState(false)
  const [apiKeyUrl, setApiKeyUrl] = useState<string | null>(null)
  const [resolvedText, setResolvedText] = useState(
    isLastTurn ? '' : `${toolkit} suggested`,
  )

  const connect = useConnectToolkit()
  const submitApiKey = useSubmitToolkitApiKey()
  const send = useSendThreadMessage()

  // `useState`'s initializer only fires on mount. If the card was first
  // rendered while it was the last turn, `phase` starts as 'choosing'
  // — but the moment a new turn starts after it, `isLastTurn` flips to
  // false and the card would otherwise keep showing live controls
  // against a now-stale nudge. Force-resolve from 'choosing' when that
  // happens, but leave 'oauth-pending' alone so a flow in progress
  // (popup open, awaiting "I've authorized…") isn't yanked out from
  // under the user mid-interaction.
  useEffect(() => {
    if (!isLastTurn && phase === 'choosing') {
      setPhase('resolved')
      setResolvedText(`${toolkit} suggested`)
    }
  }, [isLastTurn, phase, toolkit])

  const resume = (text: string) => {
    void send
      .mutateAsync({ id: threadId, text })
      .catch((err) => toastError(err, 'Could not resume'))
  }

  const handleConnect = async () => {
    try {
      const response = await connect.mutateAsync({ toolkit })
      if (response.apiKeyUrl) {
        setApiKeyUrl(response.apiKeyUrl)
      } else if (response.oauthUrl) {
        // Open the popup immediately and transition the card to
        // oauth-pending so the user has a path back to the link if
        // they dismiss the popup before opening.
        setOauthUrl(response.oauthUrl)
        setPhase('oauth-pending')
        setPopupOpen(true)
      } else {
        toast.error(`Could not start connect flow for ${toolkit}`)
      }
    } catch (err) {
      toastError(err, `Failed to connect ${toolkit}`)
    }
  }

  const handleOAuthComplete = () => {
    setResolvedText(`Connected ${toolkit}`)
    setPhase('resolved')
    setOauthUrl(null)
    resume(`I've connected ${toolkit}, continue with the task.`)
  }

  const handleSubmitApiKey = async (apiKey: string) => {
    if (!apiKeyUrl) return
    try {
      await submitApiKey.mutateAsync({ toolkit, apiKey, apiKeyUrl })
      setApiKeyUrl(null)
      setResolvedText(`Connected ${toolkit}`)
      setPhase('resolved')
      resume(`I've connected ${toolkit}, continue with the task.`)
    } catch (err) {
      toastError(err, `Failed to submit API key for ${toolkit}`)
    }
  }

  const handleManual = () => {
    setResolvedText(`Continuing without ${toolkit}`)
    setPhase('resolved')
    setOauthUrl(null)
    resume(
      `Continue without connecting ${toolkit}. Do it manually with browser automation if needed.`,
    )
  }

  if (phase === 'resolved') {
    return (
      <div className="rounded-lg border border-border/30 bg-muted/30 p-3">
        <div className="flex items-center gap-2 text-muted-foreground text-xs">
          <Check className="h-3.5 w-3.5" />
          <span>{resolvedText}</span>
        </div>
      </div>
    )
  }

  if (phase === 'oauth-pending') {
    return (
      <>
        <div className="rounded-lg border border-border/50 bg-card p-4 shadow-sm">
          <div className="flex items-start gap-3">
            <Plug className="size-5 shrink-0 text-[color:var(--accent-orange)]" />
            <div className="min-w-0 flex-1">
              <p className="font-medium text-sm">Authorize {toolkit}</p>
              <p className="mt-1 text-muted-foreground text-xs">
                Complete the sign-in in your browser, then come back here.
                Re-open the authorization link if you closed it.
              </p>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {oauthUrl ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setPopupOpen(true)}
                disabled={send.isPending}
              >
                <ExternalLink className="size-4" />
                Re-open authorization link
              </Button>
            ) : null}
            <Button
              size="sm"
              onClick={handleOAuthComplete}
              disabled={send.isPending}
            >
              I've authorized {toolkit}, continue
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={handleManual}
              disabled={send.isPending}
            >
              Skip, do it manually
            </Button>
          </div>
        </div>
        <ExternalLinkDialog
          open={popupOpen}
          onOpenChange={setPopupOpen}
          url={oauthUrl}
        />
      </>
    )
  }

  return (
    <>
      <div className="rounded-lg border border-border/50 bg-card p-4 shadow-sm">
        <div className="flex items-start gap-3">
          <Plug className="size-5 shrink-0 text-[color:var(--accent-orange)]" />
          <div>
            <p className="font-medium text-sm">
              Connect {toolkit} for better results
            </p>
            {reason ? (
              <p className="mt-1 text-muted-foreground text-xs">{reason}</p>
            ) : null}
          </div>
        </div>
        <div className="mt-3 flex gap-2">
          <Button
            size="sm"
            onClick={handleConnect}
            disabled={connect.isPending}
          >
            {connect.isPending ? 'Connecting…' : `Connect ${toolkit}`}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={handleManual}
            disabled={connect.isPending}
          >
            Do it manually
          </Button>
        </div>
      </div>

      <ApiKeyDialog
        open={!!apiKeyUrl}
        onOpenChange={(open) => {
          if (!open) setApiKeyUrl(null)
        }}
        toolkit={toolkit}
        onSubmit={handleSubmitApiKey}
        isSubmitting={submitApiKey.isPending}
      />
    </>
  )
}
