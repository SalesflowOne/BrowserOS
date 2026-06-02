import { Button } from '@company/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@company/components/ui/dialog'
import { Input } from '@company/components/ui/input'
import { Label } from '@company/components/ui/label'
import { Loader2, Plug } from 'lucide-react'
import { type FC, type FormEvent, useEffect, useState } from 'react'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  toolkit: string
  onSubmit: (apiKey: string) => void
  isSubmitting?: boolean
}

export const ApiKeyDialog: FC<Props> = ({
  open,
  onOpenChange,
  toolkit,
  onSubmit,
  isSubmitting,
}) => {
  const [apiKey, setApiKey] = useState('')

  useEffect(() => {
    if (!open) setApiKey('')
  }, [open])

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const trimmed = apiKey.trim()
    if (!trimmed) return
    onSubmit(trimmed)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[color:var(--accent-orange)]/10">
              <Plug className="size-5 text-[color:var(--accent-orange)]" />
            </div>
            <div>
              <DialogTitle>Connect {toolkit}</DialogTitle>
              <DialogDescription>
                Enter your {toolkit} API key to connect.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="mcp-api-key">API key</Label>
            <Input
              id="mcp-api-key"
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder="Paste your API key here"
              autoComplete="off"
              spellCheck={false}
              disabled={isSubmitting}
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting || !apiKey.trim()}>
              {isSubmitting ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Connecting…
                </>
              ) : (
                'Connect'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
