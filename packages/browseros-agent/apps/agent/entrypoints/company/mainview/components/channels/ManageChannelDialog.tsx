// biome-ignore-all lint/nursery/noExcessiveLinesPerFile: members + lead + add + archive on one dialog

import { Avatar } from '@company/components/chat/Avatar'
import { Button } from '@company/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@company/components/ui/dialog'
import { Label } from '@company/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@company/components/ui/select'
import type { Tint } from '@company/lib/tints'
import { cn } from '@company/lib/utils'
import {
  type ChannelDetail,
  useAddChannelMember,
  useArchiveChannel,
  usePatchChannel,
  useRemoveChannelMember,
} from '@company/modules/api/channels.hooks'
import {
  type Employee,
  useEmployees,
} from '@company/modules/api/employees.hooks'
import { toastError } from '@company/modules/api/errorToast'
import { Plus, Trash2, X } from 'lucide-react'
import type { FC } from 'react'
import { useMemo, useState } from 'react'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  channel: ChannelDetail
}

export const ManageChannelDialog: FC<Props> = ({
  open,
  onOpenChange,
  channel,
}) => {
  const employees = useEmployees()
  const addMember = useAddChannelMember()
  const removeMember = useRemoveChannelMember()
  const patchChannel = usePatchChannel()
  const archive = useArchiveChannel()
  const [confirmArchive, setConfirmArchive] = useState(false)

  const memberSet = useMemo(
    () => new Set(channel.memberIds),
    [channel.memberIds],
  )
  const memberRows = useMemo(() => {
    if (!employees.data) return [] as Employee[]
    return channel.memberIds
      .map((id) => employees.data?.find((e) => e.id === id))
      .filter((e): e is Employee => Boolean(e))
  }, [channel.memberIds, employees.data])

  const nonMembers = useMemo(() => {
    if (!employees.data) return [] as Employee[]
    return employees.data.filter((e) => !memberSet.has(e.id))
  }, [employees.data, memberSet])

  const pendingMutation =
    addMember.isPending ||
    removeMember.isPending ||
    patchChannel.isPending ||
    archive.isPending

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Manage #{channel.name}</DialogTitle>
          <DialogDescription>
            {channel.topic ?? 'No topic set.'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-5">
          <section className="flex flex-col gap-1.5">
            <Label htmlFor="manage-lead">Lead</Label>
            <Select
              value={channel.leadEmployeeId}
              onValueChange={(next) => {
                if (!next || next === channel.leadEmployeeId) return
                patchChannel.mutate(
                  { id: channel.id, leadEmployeeId: next },
                  {
                    onError: (err) => toastError(err, 'Change lead failed'),
                  },
                )
              }}
              disabled={pendingMutation}
            >
              <SelectTrigger id="manage-lead">
                <SelectValue>
                  {(value: unknown) => {
                    const lead = memberRows.find((m) => m.id === value)
                    return lead ? `${lead.name} · ${lead.role}` : ''
                  }}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {memberRows.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.name} · {m.role}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-muted-foreground text-xs">
              Untagged messages route to the lead.
            </p>
          </section>

          <section className="flex flex-col gap-1.5">
            <Label>Members ({memberRows.length})</Label>
            <div className="flex max-h-44 flex-col gap-1 overflow-y-auto rounded-md border border-border/60 p-1">
              {memberRows.map((m) => {
                const isLead = m.id === channel.leadEmployeeId
                return (
                  <div
                    key={m.id}
                    className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-sm"
                  >
                    <Avatar
                      monogram={m.monogram}
                      tint={m.tint as Tint}
                      size="xs"
                      className="shrink-0"
                    />
                    <span className="min-w-0 flex-1 truncate">{m.name}</span>
                    <span className="truncate text-muted-foreground text-xs">
                      {m.role}
                    </span>
                    {isLead ? (
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground uppercase">
                        Lead
                      </span>
                    ) : (
                      <button
                        type="button"
                        title={`Remove ${m.name}`}
                        onClick={() =>
                          removeMember.mutate(
                            { id: channel.id, employeeId: m.id },
                            {
                              onError: (err) =>
                                toastError(err, 'Remove member failed'),
                            },
                          )
                        }
                        disabled={pendingMutation}
                        className="rounded p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-40"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
            <p className="text-muted-foreground text-xs">
              Removing a member is not allowed if they're the lead — change the
              lead first.
            </p>
          </section>

          {nonMembers.length > 0 ? (
            <section className="flex flex-col gap-1.5">
              <Label>Add employees</Label>
              <div className="flex max-h-36 flex-col gap-1 overflow-y-auto rounded-md border border-border/70 border-dashed p-1">
                {nonMembers.map((emp) => (
                  <button
                    key={emp.id}
                    type="button"
                    onClick={() =>
                      addMember.mutate(
                        { id: channel.id, employeeId: emp.id },
                        {
                          onError: (err) =>
                            toastError(err, 'Add member failed'),
                        },
                      )
                    }
                    disabled={pendingMutation}
                    className={cn(
                      'flex items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted/60 disabled:opacity-50',
                    )}
                  >
                    <Plus className="size-3.5 text-muted-foreground" />
                    <Avatar
                      monogram={emp.monogram}
                      tint={emp.tint as Tint}
                      size="xs"
                      className="shrink-0"
                    />
                    <span className="min-w-0 flex-1 truncate">{emp.name}</span>
                    <span className="truncate text-muted-foreground text-xs">
                      {emp.role}
                    </span>
                  </button>
                ))}
              </div>
            </section>
          ) : null}

          <section className="flex flex-col gap-1.5 border-border/50 border-t pt-4">
            <Label className="text-destructive">Danger zone</Label>
            {confirmArchive ? (
              <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs">
                <span className="flex-1 text-destructive">
                  Archive this channel? Transcript stays, channel disappears
                  from the rail.
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setConfirmArchive(false)}
                  disabled={pendingMutation}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() =>
                    archive.mutate(
                      { id: channel.id },
                      {
                        onSuccess: () => onOpenChange(false),
                        onError: (err) => toastError(err, 'Archive failed'),
                      },
                    )
                  }
                  disabled={pendingMutation}
                >
                  Archive
                </Button>
              </div>
            ) : (
              <Button
                variant="outline"
                size="sm"
                className="self-start text-destructive hover:bg-destructive/10"
                onClick={() => setConfirmArchive(true)}
                disabled={pendingMutation}
              >
                Archive channel
              </Button>
            )}
          </section>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            <X className="mr-1 size-3.5" />
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
