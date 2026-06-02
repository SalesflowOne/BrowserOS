import { Button } from '@company/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@company/components/ui/dialog'
import { Check, Copy, ExternalLink } from 'lucide-react'
import { type FC, useEffect, useState } from 'react'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  url: string | null
  // Fires after the user successfully chooses "Open link". The handoff
  // has already happened (we called window.open which the main process
  // routes through shell.openExternal); this just lets the parent
  // record that the user took the open action.
  onOpened?: () => void
}

// Mirrors Streamdown's built-in `link-safety-modal` so the
// programmatic-open flow (e.g. clicking "Connect Google Calendar"
// straight from the nudge card) lands in a popup that's
// visually consistent with what the user already sees when they
// click a regular markdown link in chat.
export const ExternalLinkDialog: FC<Props> = ({
  open,
  onOpenChange,
  url,
  onOpened,
}) => {
  const [copied, setCopied] = useState(false)

  // Reset "Copied" indicator when the dialog closes so a re-open
  // doesn't start in the post-copy state.
  useEffect(() => {
    if (!open) setCopied(false)
  }, [open])

  if (!url) return null

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      // navigator.clipboard can throw in non-secure contexts; surfacing
      // a toast here would be overkill — the user can still hit Open.
    }
  }

  const handleOpen = () => {
    // window.open hits the main process's setWindowOpenHandler, which
    // denies the in-app popup and routes the URL through
    // shell.openExternal → system default browser. See main/index.ts.
    window.open(url, '_blank', 'noreferrer')
    onOpened?.()
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ExternalLink className="size-5" />
            Open external link?
          </DialogTitle>
          <DialogDescription>
            You're about to visit an external website.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-32 overflow-y-auto break-all rounded-md bg-muted p-3 font-mono text-sm">
          {url}
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            className="flex-1"
            onClick={handleCopy}
          >
            {copied ? (
              <>
                <Check className="size-4" />
                Copied
              </>
            ) : (
              <>
                <Copy className="size-4" />
                Copy link
              </>
            )}
          </Button>
          <Button type="button" className="flex-1" onClick={handleOpen}>
            <ExternalLink className="size-4" />
            Open link
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
