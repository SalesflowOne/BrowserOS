import { McpServerForm } from '@company/components/settings/McpServerForm'
import { McpServerRow } from '@company/components/settings/McpServerRow'
import { Button } from '@company/components/ui/button'
import { Dialog, DialogContent } from '@company/components/ui/dialog'
import { toastError } from '@company/modules/api/errorToast'
import {
  type McpServer,
  type McpServerDraft,
  useMcpRegistry,
} from '@company/modules/api/system.hooks'
import { Plus } from 'lucide-react'
import { useState } from 'react'

export function Mcp() {
  const { servers, isLoading, isUpdating, add, update, remove } =
    useMcpRegistry()
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<McpServer | null>(null)

  const openAdd = () => {
    setEditing(null)
    setOpen(true)
  }

  const openEdit = (server: McpServer) => {
    setEditing(server)
    setOpen(true)
  }

  const onSubmit = async (draft: McpServerDraft) => {
    try {
      if (editing) await update(editing.id, draft)
      else await add(draft)
      setOpen(false)
      setEditing(null)
    } catch (err) {
      toastError(err, 'Could not save MCP server')
    }
  }

  const onRemove = async (id: string) => {
    try {
      await remove(id)
    } catch (err) {
      toastError(err, 'Could not remove MCP server')
    }
  }

  const existingNames = servers
    .filter((server) => server.id !== editing?.id)
    .map((server) => server.name)

  return (
    <div className="w-full max-w-3xl px-6 py-6">
      <section className="rounded-lg border border-border/70 bg-card/40">
        <div className="flex items-start justify-between gap-3 border-border/60 border-b px-4 py-3">
          <div className="min-w-0">
            <h2 className="font-medium text-[15px]">MCP servers</h2>
            <p className="mt-1 text-muted-foreground text-sm">
              Tools from these servers become available to every new
              conversation.
            </p>
          </div>
          <Button type="button" onClick={openAdd}>
            <Plus className="size-4" />
            Add server
          </Button>
        </div>

        {isLoading ? (
          <p className="px-4 py-8 text-center text-muted-foreground text-sm">
            Loading…
          </p>
        ) : servers.length === 0 ? (
          <p className="px-4 py-10 text-center text-muted-foreground text-sm">
            No servers yet. Add one to give every new conversation extra tools.
          </p>
        ) : (
          <ul className="divide-y divide-border/60">
            {servers.map((server) => (
              <McpServerRow
                key={server.id}
                server={server}
                disabled={isUpdating}
                onEdit={() => openEdit(server)}
                onRemove={() => onRemove(server.id)}
              />
            ))}
          </ul>
        )}
      </section>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-xl">
          <McpServerForm
            server={editing}
            existingNames={existingNames}
            submitting={isUpdating}
            onSubmit={onSubmit}
          />
        </DialogContent>
      </Dialog>
    </div>
  )
}
