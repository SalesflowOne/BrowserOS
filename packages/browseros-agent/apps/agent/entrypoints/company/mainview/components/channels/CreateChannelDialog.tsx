// biome-ignore-all lint/nursery/noExcessiveLinesPerFile: one form, multi-field validation lives together

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
import { Input } from '@company/components/ui/input'
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
import { useCreateChannel } from '@company/modules/api/channels.hooks'
import {
  type Employee,
  useEmployees,
} from '@company/modules/api/employees.hooks'
import { toastError } from '@company/modules/api/errorToast'
import { zodResolver } from '@hookform/resolvers/zod'
import { useNavigate } from '@tanstack/react-router'
import { Check } from 'lucide-react'
import type { FC } from 'react'
import { useEffect, useMemo } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'

// Mirror of the server-side schema in routes/channels.ts. Kept in
// sync by hand; if either side changes, update both.
const CHANNEL_NAME_RE = /^[a-z0-9][a-z0-9-]{0,49}$/

const formSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, 'Name is required.')
      .max(50)
      .regex(
        CHANNEL_NAME_RE,
        'Lowercase letters, digits, hyphens — no spaces.',
      ),
    topic: z.string().trim().max(200, 'Max 200 characters.').optional(),
    memberIds: z.array(z.string().min(1)).min(1, 'Pick at least one member.'),
    leadEmployeeId: z.string().min(1, 'Pick a lead.'),
  })
  .superRefine((data, ctx) => {
    if (!data.memberIds.includes(data.leadEmployeeId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['leadEmployeeId'],
        message: 'The lead must be one of the selected members.',
      })
    }
  })

type FormValues = z.infer<typeof formSchema>

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export const CreateChannelDialog: FC<Props> = ({ open, onOpenChange }) => {
  const employees = useEmployees()
  const create = useCreateChannel()
  const navigate = useNavigate()

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { name: '', topic: '', memberIds: [], leadEmployeeId: '' },
  })

  // Reset the form whenever the dialog re-opens so a previous submit
  // doesn't leak state into the next session.
  useEffect(() => {
    if (open) {
      form.reset({ name: '', topic: '', memberIds: [], leadEmployeeId: '' })
    }
  }, [open, form])

  const memberIds = form.watch('memberIds')
  const selectedMembers = useMemo(() => {
    const lookup = new Map((employees.data ?? []).map((e) => [e.id, e]))
    return memberIds
      .map((id) => lookup.get(id))
      .filter((e): e is NonNullable<typeof e> => Boolean(e))
  }, [memberIds, employees.data])

  const onSubmit = form.handleSubmit((values) => {
    create.mutate(
      {
        name: values.name,
        topic:
          values.topic && values.topic.length > 0 ? values.topic : undefined,
        memberIds: values.memberIds,
        leadEmployeeId: values.leadEmployeeId,
      },
      {
        onSuccess: (channel) => {
          onOpenChange(false)
          void navigate({
            to: '/c/$channelId',
            params: { channelId: channel.id },
          })
        },
        onError: (err) => toastError(err, 'Create channel failed'),
      },
    )
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>New channel</DialogTitle>
          <DialogDescription>
            Pick a name, the members who'll work here, and who leads it. The
            lead receives messages you don't explicitly address.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="channel-name">Name</Label>
            <Input
              id="channel-name"
              autoComplete="off"
              placeholder="launch-v2"
              {...form.register('name')}
            />
            {form.formState.errors.name ? (
              <p className="text-destructive text-xs">
                {form.formState.errors.name.message}
              </p>
            ) : (
              <p className="text-muted-foreground text-xs">
                Lowercase letters, digits, hyphens. Max 50 characters.
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="channel-topic">Topic (optional)</Label>
            <Input
              id="channel-topic"
              autoComplete="off"
              placeholder="Coordinating the v2 launch — copy, design, eng"
              {...form.register('topic')}
            />
            {form.formState.errors.topic ? (
              <p className="text-destructive text-xs">
                {form.formState.errors.topic.message}
              </p>
            ) : null}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Members</Label>
            <MemberPicker
              employees={employees.data ?? []}
              selectedIds={memberIds}
              onToggle={(id) => {
                const next = memberIds.includes(id)
                  ? memberIds.filter((m) => m !== id)
                  : [...memberIds, id]
                form.setValue('memberIds', next, { shouldValidate: true })
                // If the current lead got removed, clear it.
                const currentLead = form.getValues('leadEmployeeId')
                if (currentLead && !next.includes(currentLead)) {
                  form.setValue('leadEmployeeId', '', {
                    shouldValidate: true,
                  })
                }
              }}
            />
            {form.formState.errors.memberIds ? (
              <p className="text-destructive text-xs">
                {form.formState.errors.memberIds.message}
              </p>
            ) : null}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="channel-lead">Lead</Label>
            <Select
              value={form.watch('leadEmployeeId')}
              onValueChange={(v) =>
                form.setValue('leadEmployeeId', v ?? '', {
                  shouldValidate: true,
                })
              }
              disabled={selectedMembers.length === 0}
            >
              <SelectTrigger id="channel-lead">
                <SelectValue
                  placeholder={
                    selectedMembers.length === 0
                      ? 'Pick members first'
                      : 'Pick a lead'
                  }
                >
                  {(value: unknown) => {
                    const lead = selectedMembers.find((m) => m.id === value)
                    return lead ? `${lead.name} · ${lead.role}` : ''
                  }}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {selectedMembers.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.name} · {m.role}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {form.formState.errors.leadEmployeeId ? (
              <p className="text-destructive text-xs">
                {form.formState.errors.leadEmployeeId.message}
              </p>
            ) : (
              <p className="text-muted-foreground text-xs">
                Untagged messages route here. Can be changed later.
              </p>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? 'Creating…' : 'Create channel'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

const MemberPicker: FC<{
  employees: Employee[]
  selectedIds: string[]
  onToggle: (employeeId: string) => void
}> = ({ employees, selectedIds, onToggle }) => {
  if (employees.length === 0) {
    return (
      <p className="rounded-md border border-border/70 border-dashed px-3 py-2 text-center text-muted-foreground text-xs">
        No employees yet. Hire someone before creating a channel.
      </p>
    )
  }
  return (
    <div className="flex max-h-44 flex-col gap-1 overflow-y-auto rounded-md border border-border/60 p-1">
      {employees.map((emp) => {
        const checked = selectedIds.includes(emp.id)
        return (
          <button
            key={emp.id}
            type="button"
            onClick={() => onToggle(emp.id)}
            className={cn(
              'flex items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm transition-colors',
              checked ? 'bg-muted text-foreground' : 'hover:bg-muted/50',
            )}
          >
            <span
              className={cn(
                'flex size-4 shrink-0 items-center justify-center rounded-sm border',
                checked
                  ? 'border-foreground bg-foreground text-background'
                  : 'border-border',
              )}
            >
              {checked ? <Check className="size-3" /> : null}
            </span>
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
        )
      })}
    </div>
  )
}
