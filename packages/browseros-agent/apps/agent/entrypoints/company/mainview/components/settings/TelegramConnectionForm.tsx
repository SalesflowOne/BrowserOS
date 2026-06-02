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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@company/components/ui/select'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { z } from 'zod'

const formSchema = z.object({
  employeeId: z.string().min(1, 'Pick an employee'),
  name: z.string().trim().min(1, 'Required').max(80, 'Max 80 characters'),
  botUsername: z
    .string()
    .trim()
    .max(64, 'Max 64 characters')
    .optional()
    .or(z.literal('')),
  botToken: z
    .string()
    .trim()
    .min(10, 'Token looks too short — paste the full BotFather string'),
})

export type TelegramFormValues = z.infer<typeof formSchema>

interface Props {
  availableEmployees: { id: string; name: string; role: string }[]
  submitting: boolean
  onSubmit: (values: TelegramFormValues) => void
}

export function TelegramConnectionForm({
  availableEmployees,
  submitting,
  onSubmit,
}: Props) {
  const form = useForm<TelegramFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      employeeId: availableEmployees[0]?.id ?? '',
      name: '',
      botUsername: '',
      botToken: '',
    },
  })

  const submit = form.handleSubmit((values) => {
    onSubmit({
      ...values,
      name: values.name.trim(),
      botUsername: values.botUsername?.trim() || undefined,
      botToken: values.botToken.trim(),
    })
  })

  const employeeError = form.formState.errors.employeeId?.message
  const nameError = form.formState.errors.name?.message
  const usernameError = form.formState.errors.botUsername?.message
  const tokenError = form.formState.errors.botToken?.message
  const employeeId = form.watch('employeeId')

  const noEmployeesAvailable = availableEmployees.length === 0

  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      <DialogHeader>
        <DialogTitle>Connect a Telegram bot</DialogTitle>
        <DialogDescription>
          Create a bot in Telegram via{' '}
          <span className="font-mono">@BotFather</span>, paste its token below,
          and pick which employee should answer messages sent to it.
        </DialogDescription>
      </DialogHeader>

      <div className="flex flex-col gap-4">
        <FieldRow label="Employee" error={employeeError}>
          {noEmployeesAvailable ? (
            <p className="text-muted-foreground text-sm">
              Every employee already has a bot. Remove an existing connection
              first or hire a new employee.
            </p>
          ) : (
            <Select
              value={employeeId}
              onValueChange={(value) =>
                form.setValue('employeeId', value ?? '', {
                  shouldValidate: true,
                })
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Pick an employee">
                  {(value) => {
                    const selected = availableEmployees.find(
                      (e) => e.id === value,
                    )
                    return selected
                      ? `${selected.name} — ${selected.role}`
                      : value
                  }}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {availableEmployees.map((employee) => (
                  <SelectItem key={employee.id} value={employee.id}>
                    {employee.name} — {employee.role}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </FieldRow>

        <FieldRow label="Display name" error={nameError}>
          <Input
            placeholder="Sam's phone bot"
            spellCheck={false}
            {...form.register('name')}
          />
        </FieldRow>

        <FieldRow
          label="Bot username (optional)"
          error={usernameError}
          hint="The handle BotFather assigned, e.g. sam_company_bot."
        >
          <Input
            placeholder="sam_company_bot"
            spellCheck={false}
            autoCapitalize="none"
            {...form.register('botUsername')}
          />
        </FieldRow>

        <FieldRow
          label="Bot token"
          error={tokenError}
          hint="Stored encrypted via your OS keychain. Never displayed back."
        >
          <Input
            type="password"
            placeholder="123456:ABC-DEF..."
            spellCheck={false}
            autoComplete="off"
            {...form.register('botToken')}
          />
        </FieldRow>
      </div>

      <DialogFooter>
        <DialogClose render={<Button type="button" variant="outline" />}>
          Cancel
        </DialogClose>
        <Button type="submit" disabled={submitting || noEmployeesAvailable}>
          {submitting ? 'Connecting' : 'Connect bot'}
        </Button>
      </DialogFooter>
    </form>
  )
}

function FieldRow({
  label,
  hint,
  error,
  children,
}: {
  label: string
  hint?: string
  error?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-xs">{label}</Label>
      {children}
      {hint && !error ? (
        <p className="text-muted-foreground text-xs">{hint}</p>
      ) : null}
      {error ? <p className="text-destructive text-xs">{error}</p> : null}
    </div>
  )
}
