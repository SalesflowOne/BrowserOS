// biome-ignore-all lint/nursery/noExcessiveLinesPerFile: one coherent form — splitting helpers across files hurts navigation more than the line count helps

import { Button } from '@company/components/ui/button'
import {
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@company/components/ui/dialog'
import { Input } from '@company/components/ui/input'
import { Label } from '@company/components/ui/label'
import type {
  McpServer,
  McpServerDraft,
} from '@company/modules/api/system.hooks'
import { zodResolver } from '@hookform/resolvers/zod'
import { Plus, Trash2 } from 'lucide-react'
import { useEffect } from 'react'
import { type Path, useFieldArray, useForm } from 'react-hook-form'
import { z } from 'zod'

// Required-field validation lives in this client schema so the user sees a
// per-field error rather than a top-level server reject. Trimming before
// min(1) keeps whitespace-only input from slipping past to the server.
const namedValueSchema = z.object({
  name: z.string().trim().min(1, 'Required'),
  value: z.string().min(1, 'Required'),
})

const formSchema = z
  .object({
    name: z.string().trim().min(1, 'Required'),
    transport: z.enum(['stdio', 'http', 'sse']),
    command: z.string(),
    args: z.array(z.object({ value: z.string() })),
    env: z.array(namedValueSchema),
    url: z.string(),
    headers: z.array(namedValueSchema),
  })
  .superRefine((data, ctx) => {
    if (data.transport === 'stdio') {
      if (!data.command.trim()) {
        ctx.addIssue({
          code: 'custom',
          path: ['command'],
          message: 'Command is required',
        })
      }
      return
    }
    if (!data.url.trim()) {
      ctx.addIssue({
        code: 'custom',
        path: ['url'],
        message: 'URL is required',
      })
      return
    }
    if (!/^https?:\/\//i.test(data.url)) {
      ctx.addIssue({
        code: 'custom',
        path: ['url'],
        message: 'URL must start with http:// or https://',
      })
    }
  })

type FormValues = z.infer<typeof formSchema>

const EMPTY: FormValues = {
  name: '',
  transport: 'stdio',
  command: '',
  args: [],
  env: [],
  url: '',
  headers: [],
}

interface Props {
  server: McpServer | null
  existingNames: string[]
  submitting: boolean
  onSubmit: (draft: McpServerDraft) => void
}

export function McpServerForm({
  server,
  existingNames,
  submitting,
  onSubmit,
}: Props) {
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: server ? toFormValues(server) : EMPTY,
  })

  useEffect(() => {
    form.reset(server ? toFormValues(server) : EMPTY)
  }, [server, form])

  const transport = form.watch('transport')
  const args = useFieldArray({ control: form.control, name: 'args' })
  const env = useFieldArray({ control: form.control, name: 'env' })
  const headers = useFieldArray({ control: form.control, name: 'headers' })

  const submit = form.handleSubmit((values) => {
    const trimmedName = values.name.trim()
    if (existingNames.includes(trimmedName)) {
      form.setError('name', { message: 'Name is already used' })
      return
    }
    onSubmit(toDraft({ ...values, name: trimmedName }))
  })

  const title = server ? 'Edit MCP server' : 'Add MCP server'
  const description = server
    ? 'Change how this MCP server connects.'
    : 'Tools from this server become available to every new conversation.'

  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>

      <div className="flex flex-col gap-4">
        <FieldRow label="Name" error={form.formState.errors.name?.message}>
          <Input
            placeholder="my-server"
            spellCheck={false}
            {...form.register('name')}
          />
        </FieldRow>

        <FieldRow label="Transport">
          <div className="flex gap-2">
            <TransportButton
              active={transport === 'stdio'}
              onClick={() => form.setValue('transport', 'stdio')}
            >
              stdio
            </TransportButton>
            <TransportButton
              active={transport === 'http'}
              onClick={() => form.setValue('transport', 'http')}
            >
              http
            </TransportButton>
            <TransportButton
              active={transport === 'sse'}
              onClick={() => form.setValue('transport', 'sse')}
            >
              sse
            </TransportButton>
          </div>
        </FieldRow>

        {transport === 'stdio' ? (
          <>
            <FieldRow
              label="Command"
              error={form.formState.errors.command?.message}
            >
              <Input
                placeholder="bunx"
                spellCheck={false}
                {...form.register('command')}
              />
            </FieldRow>
            <DynamicList
              label="Arguments"
              addLabel="Add argument"
              items={args.fields}
              onAppend={() => args.append({ value: '' })}
              onRemove={(index) => args.remove(index)}
              renderItem={(_field, index) => (
                <Input
                  placeholder="--flag or value"
                  spellCheck={false}
                  {...form.register(`args.${index}.value`)}
                />
              )}
            />
            <PairList
              label="Environment"
              addLabel="Add variable"
              items={env.fields}
              onAppend={() => env.append({ name: '', value: '' })}
              onRemove={(index) => env.remove(index)}
              nameRegister={(index) =>
                form.register(`env.${index}.name` as Path<FormValues>)
              }
              valueRegister={(index) =>
                form.register(`env.${index}.value` as Path<FormValues>)
              }
              errorAt={(index) =>
                form.formState.errors.env?.[index]?.name?.message ??
                form.formState.errors.env?.[index]?.value?.message
              }
            />
          </>
        ) : (
          <>
            <FieldRow label="URL" error={form.formState.errors.url?.message}>
              <Input
                placeholder="https://example.com/mcp"
                spellCheck={false}
                {...form.register('url')}
              />
            </FieldRow>
            <PairList
              label="Headers"
              addLabel="Add header"
              items={headers.fields}
              onAppend={() => headers.append({ name: '', value: '' })}
              onRemove={(index) => headers.remove(index)}
              nameRegister={(index) =>
                form.register(`headers.${index}.name` as Path<FormValues>)
              }
              valueRegister={(index) =>
                form.register(`headers.${index}.value` as Path<FormValues>)
              }
              errorAt={(index) =>
                form.formState.errors.headers?.[index]?.name?.message ??
                form.formState.errors.headers?.[index]?.value?.message
              }
            />
          </>
        )}
      </div>

      <DialogFooter>
        <DialogClose render={<Button type="button" variant="outline" />}>
          Cancel
        </DialogClose>
        <Button type="submit" disabled={submitting}>
          {submitting ? 'Saving' : server ? 'Save changes' : 'Add server'}
        </Button>
      </DialogFooter>
    </form>
  )
}

function FieldRow({
  label,
  error,
  children,
}: {
  label: string
  error?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-xs">{label}</Label>
      {children}
      {error ? <p className="text-destructive text-xs">{error}</p> : null}
    </div>
  )
}

function TransportButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <Button
      type="button"
      variant={active ? 'default' : 'outline'}
      size="sm"
      onClick={onClick}
    >
      {children}
    </Button>
  )
}

interface DynamicListProps<T> {
  label: string
  addLabel: string
  items: T[]
  onAppend: () => void
  onRemove: (index: number) => void
  renderItem: (field: T, index: number) => React.ReactNode
}

function DynamicList<T extends { id: string }>({
  label,
  addLabel,
  items,
  onAppend,
  onRemove,
  renderItem,
}: DynamicListProps<T>) {
  return (
    <div className="flex flex-col gap-2">
      <Label className="text-xs">{label}</Label>
      {items.map((field, index) => (
        <div key={field.id} className="flex gap-2">
          {renderItem(field, index)}
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => onRemove(index)}
            aria-label="Remove"
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onAppend}
        className="self-start"
      >
        <Plus className="size-4" />
        {addLabel}
      </Button>
    </div>
  )
}

interface PairListProps {
  label: string
  addLabel: string
  items: { id: string }[]
  onAppend: () => void
  onRemove: (index: number) => void
  nameRegister: (
    index: number,
  ) => ReturnType<ReturnType<typeof useForm<FormValues>>['register']>
  valueRegister: (
    index: number,
  ) => ReturnType<ReturnType<typeof useForm<FormValues>>['register']>
  errorAt: (index: number) => string | undefined
}

function PairList({
  label,
  addLabel,
  items,
  onAppend,
  onRemove,
  nameRegister,
  valueRegister,
  errorAt,
}: PairListProps) {
  return (
    <div className="flex flex-col gap-2">
      <Label className="text-xs">{label}</Label>
      {items.map((field, index) => {
        const error = errorAt(index)
        return (
          <div key={field.id} className="flex flex-col gap-1">
            <div className="flex gap-2">
              <Input
                placeholder="NAME"
                spellCheck={false}
                {...nameRegister(index)}
              />
              <Input
                placeholder="value"
                spellCheck={false}
                {...valueRegister(index)}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => onRemove(index)}
                aria-label="Remove"
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
            {error ? <p className="text-destructive text-xs">{error}</p> : null}
          </div>
        )
      })}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onAppend}
        className="self-start"
      >
        <Plus className="size-4" />
        {addLabel}
      </Button>
    </div>
  )
}

function toFormValues(server: McpServer): FormValues {
  if (server.type === 'stdio') {
    return {
      name: server.name,
      transport: 'stdio',
      command: server.command,
      args: server.args.map((value) => ({ value })),
      env: server.env,
      url: '',
      headers: [],
    }
  }
  return {
    name: server.name,
    transport: server.type,
    command: '',
    args: [],
    env: [],
    url: server.url,
    headers: server.headers,
  }
}

function toDraft(values: FormValues): McpServerDraft {
  if (values.transport === 'stdio') {
    return {
      type: 'stdio',
      name: values.name,
      command: values.command.trim(),
      args: values.args
        .map((entry) => entry.value)
        .filter((value) => value.length > 0),
      env: values.env.map((entry) => ({
        name: entry.name.trim(),
        value: entry.value,
      })),
    }
  }
  return {
    type: values.transport,
    name: values.name,
    url: values.url.trim(),
    headers: values.headers.map((entry) => ({
      name: entry.name.trim(),
      value: entry.value,
    })),
  }
}
