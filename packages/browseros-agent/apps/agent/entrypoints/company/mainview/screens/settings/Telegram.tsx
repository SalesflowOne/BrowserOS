import {
  TelegramConnectionForm,
  type TelegramFormValues,
} from '@company/components/settings/TelegramConnectionForm'
import { TelegramConnectionRow } from '@company/components/settings/TelegramConnectionRow'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@company/components/ui/alert-dialog'
import { Button } from '@company/components/ui/button'
import { Dialog, DialogContent } from '@company/components/ui/dialog'
import { useEmployees } from '@company/modules/api/employees.hooks'
import { toastError } from '@company/modules/api/errorToast'
import {
  type TelegramConnection,
  useCreateTelegramConnection,
  useDeleteTelegramConnection,
  useRestartTelegramConnection,
  useTelegramConnections,
} from '@company/modules/api/telegram.hooks'
import { Plus } from 'lucide-react'
import { useMemo, useState } from 'react'

export function Telegram() {
  const { data: connections = [], isLoading } = useTelegramConnections()
  const { data: employees = [] } = useEmployees()
  const create = useCreateTelegramConnection()
  const remove = useDeleteTelegramConnection()
  const restart = useRestartTelegramConnection()

  const [open, setOpen] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState<TelegramConnection | null>(
    null,
  )

  const employeesById = useMemo(() => {
    const map = new Map<string, (typeof employees)[number]>()
    for (const e of employees) map.set(e.id, e)
    return map
  }, [employees])

  const availableEmployees = useMemo(() => {
    const taken = new Set(connections.map((c) => c.employeeId))
    return employees.filter((e) => !taken.has(e.id))
  }, [employees, connections])

  const onSubmit = async (values: TelegramFormValues) => {
    try {
      await create.mutateAsync({
        employeeId: values.employeeId,
        body: {
          name: values.name,
          botUsername: values.botUsername || undefined,
          botToken: values.botToken,
        },
      })
      setOpen(false)
    } catch (err) {
      toastError(err, 'Could not connect bot')
    }
  }

  const onRestart = async (id: string) => {
    try {
      await restart.mutateAsync({ id })
    } catch (err) {
      toastError(err, 'Could not restart bot')
    }
  }

  const onConfirmRemove = async () => {
    if (!confirmRemove) return
    const target = confirmRemove
    setConfirmRemove(null)
    try {
      await remove.mutateAsync({ id: target.id })
    } catch (err) {
      toastError(err, 'Could not remove bot')
    }
  }

  const updating = create.isPending || remove.isPending || restart.isPending

  return (
    <div className="w-full max-w-3xl px-6 py-6">
      <section className="rounded-lg border border-border/70 bg-card/40">
        <div className="flex items-start justify-between gap-3 border-border/60 border-b px-4 py-3">
          <div className="min-w-0">
            <h2 className="font-medium text-[15px]">Telegram bots</h2>
            <p className="mt-1 text-muted-foreground text-sm">
              Each bot routes inbound messages to a specific employee. Tokens
              are stored encrypted via your OS keychain.
            </p>
          </div>
          <Button
            type="button"
            onClick={() => setOpen(true)}
            disabled={availableEmployees.length === 0}
          >
            <Plus className="size-4" />
            Connect bot
          </Button>
        </div>

        {isLoading ? (
          <p className="px-4 py-8 text-center text-muted-foreground text-sm">
            Loading…
          </p>
        ) : connections.length === 0 ? (
          <p className="px-4 py-10 text-center text-muted-foreground text-sm">
            No bots yet. Connect one to chat with your employees from your
            phone.
          </p>
        ) : (
          <ul className="divide-y divide-border/60">
            {connections.map((connection) => (
              <TelegramConnectionRow
                key={connection.id}
                connection={connection}
                employeeName={
                  employeesById.get(connection.employeeId)?.name ?? null
                }
                disabled={updating}
                onRestart={() => onRestart(connection.id)}
                onRemove={() => setConfirmRemove(connection)}
              />
            ))}
          </ul>
        )}
      </section>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-xl">
          <TelegramConnectionForm
            availableEmployees={availableEmployees.map((e) => ({
              id: e.id,
              name: e.name,
              role: e.role,
            }))}
            submitting={create.isPending}
            onSubmit={onSubmit}
          />
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={confirmRemove !== null}
        onOpenChange={(next) => {
          if (!next) setConfirmRemove(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this bot?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmRemove
                ? `"${confirmRemove.name}" will stop polling Telegram. Existing threads stay in the desktop app — only the bot link is removed.`
                : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={onConfirmRemove}>
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
