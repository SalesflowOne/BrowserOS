import { Avatar } from '@company/components/chat/Avatar'
import { HireDialog } from '@company/components/chat/HireDialog'
import { Button } from '@company/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@company/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@company/components/ui/dropdown-menu'
import type { Tint } from '@company/lib/tints'
import { cn } from '@company/lib/utils'
import type { EmployeeWithRecent } from '@company/modules/api/employees.hooks'
import { ArrowUp, ChevronDown, UserPlus } from 'lucide-react'
import { type FC, type KeyboardEvent, useEffect, useRef, useState } from 'react'
import {
  initialTupleForEmployee,
  useEmployeesForPicker,
  useSendNewChat,
} from './new-chat-dialog.hooks'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
}

// Fixed dialog size so the popup doesn't morph as the draft grows.
// Width tuned to fit a typical "few sentences" message without
// horizontal scrolling; height gives the message area visible breathing
// room even when empty (avoids the "tiny strip" feeling).
const DIALOG_WIDTH = '640px'
const DIALOG_HEIGHT = '440px'

export const NewChatDialog: FC<Props> = ({ open, onOpenChange }) => {
  const { employees, isReady } = useEmployeesForPicker()
  const send = useSendNewChat()

  const [draft, setDraft] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Derive the default inline from the same `employees` array the
  // dropdown reads. A latest-default ref lets the open-transition
  // effect grab the current value without subscribing to it, so a
  // background refetch (window focus, rail invalidation) can shift
  // recency ordering without silently clobbering the user's manual
  // pick. The ref is updated on every render so the next dialog open
  // always preselects the freshest last-used teammate.
  const defaultId = employees[0]?.id ?? null
  const defaultIdRef = useRef(defaultId)
  defaultIdRef.current = defaultId

  // Sync the preselected recipient ONLY on the open-transition. After
  // the dialog is open the selection belongs to the user; we never
  // overwrite it from props or upstream data.
  useEffect(() => {
    if (open) {
      setSelectedId(defaultIdRef.current)
      requestAnimationFrame(() => textareaRef.current?.focus())
    }
  }, [open])

  // Deliberate reset on close: an accidental Esc loses the draft so a
  // fresh open is a fresh thought. Persisting would feel haunted.
  useEffect(() => {
    if (!open) setDraft('')
  }, [open])

  const selected = employees.find((e) => e.id === selectedId) ?? null
  const canSend =
    draft.trim().length > 0 && selected !== null && !send.isPending

  const handleSubmit = async () => {
    if (!canSend || !selected) return
    try {
      await send.submit({
        employeeId: selected.id,
        text: draft,
        tuple: initialTupleForEmployee(selected),
      })
      onOpenChange(false)
    } catch {
      // useSendNewChat toasts; keep the dialog + draft so retry is easy.
    }
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      void handleSubmit()
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        style={{ width: DIALOG_WIDTH, height: DIALOG_HEIGHT }}
        className="!max-w-none flex flex-col gap-0 overflow-hidden p-0"
      >
        {/* a11y title; the recipient chip is the visible header */}
        <DialogTitle className="sr-only">New chat</DialogTitle>

        {isReady && employees.length === 0 ? (
          <EmptyState onOpenChange={onOpenChange} />
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">
            <RecipientHeader
              selected={selected}
              employees={employees}
              onSelect={setSelectedId}
              disabled={send.isPending}
            />

            <textarea
              ref={textareaRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                selected
                  ? `What should ${selected.name} pick up?`
                  : 'What do you need?'
              }
              className="min-h-0 flex-1 resize-none border-0 bg-transparent px-5 py-4 text-[14.5px] leading-relaxed outline-none placeholder:text-muted-foreground/50"
              disabled={send.isPending}
            />

            <div className="flex items-center justify-between gap-3 border-border/50 border-t px-5 py-3">
              <p className="text-[11px] text-muted-foreground/60">
                <kbd className="rounded bg-muted/60 px-1.5 py-0.5 font-mono text-[10px]">
                  Enter
                </kbd>{' '}
                to send ·{' '}
                <kbd className="rounded bg-muted/60 px-1.5 py-0.5 font-mono text-[10px]">
                  Shift
                </kbd>
                +
                <kbd className="rounded bg-muted/60 px-1.5 py-0.5 font-mono text-[10px]">
                  Enter
                </kbd>{' '}
                for newline
              </p>
              <SendButton
                onClick={() => void handleSubmit()}
                disabled={!canSend}
                pending={send.isPending}
                tint={selected?.tint as Tint | undefined}
                aria-label={selected ? `Send to ${selected.name}` : 'Send'}
              />
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

interface RecipientProps {
  selected: EmployeeWithRecent | null
  employees: EmployeeWithRecent[]
  onSelect: (id: string) => void
  disabled: boolean
}

const RecipientHeader: FC<RecipientProps> = ({
  selected,
  employees,
  onSelect,
  disabled,
}) => {
  return (
    <div className="flex items-center gap-3 border-border/50 border-b px-5 py-3">
      <span className="text-[11.5px] text-muted-foreground/70 uppercase tracking-[0.14em]">
        To
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger
          disabled={disabled || !selected}
          render={
            <button
              type="button"
              className={cn(
                'group inline-flex items-center gap-2 rounded-full bg-muted/40 py-1 pr-2 pl-1 transition-colors',
                'hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60',
              )}
            />
          }
        >
          {selected ? (
            <>
              <Avatar
                monogram={selected.monogram}
                tint={selected.tint as Tint}
                size="xs"
              />
              <span className="font-medium text-[13px] text-foreground">
                {selected.name}
              </span>
              <span className="text-[12px] text-muted-foreground">
                · {selected.role}
              </span>
              <ChevronDown className="size-3.5 text-muted-foreground/70 transition-transform group-data-popup-open:rotate-180" />
            </>
          ) : (
            <span className="px-2 text-[13px] text-muted-foreground">
              Pick a teammate
            </span>
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-[260px]">
          {employees.map((e) => (
            <DropdownMenuItem
              key={e.id}
              onClick={() => onSelect(e.id)}
              className="flex items-center gap-3 py-2"
            >
              <Avatar monogram={e.monogram} tint={e.tint as Tint} size="sm" />
              <div className="min-w-0 flex-1 leading-tight">
                <p className="truncate font-medium text-[13px]">{e.name}</p>
                <p className="truncate text-[11.5px] text-muted-foreground">
                  {e.role}
                </p>
              </div>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

interface SendButtonProps {
  onClick: () => void
  disabled: boolean
  pending: boolean
  tint?: Tint
  'aria-label': string
}

const SendButton: FC<SendButtonProps> = ({
  onClick,
  disabled,
  pending,
  'aria-label': ariaLabel,
}) => {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      className={cn(
        'inline-flex size-9 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm transition-all',
        'hover:bg-primary/90 hover:shadow-md',
        'disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground/60 disabled:shadow-none',
        pending && 'animate-pulse',
      )}
    >
      <ArrowUp className="size-4" />
    </button>
  )
}

const EmptyState: FC<{ onOpenChange: (open: boolean) => void }> = ({
  onOpenChange,
}) => {
  const [hireOpen, setHireOpen] = useState(false)
  return (
    <>
      <DialogTitle className="sr-only">New chat</DialogTitle>
      <div className="flex flex-col items-center gap-4 px-6 py-12 text-center">
        <UserPlus className="size-7 text-muted-foreground/60" />
        <p className="max-w-[28ch] text-[13.5px] text-muted-foreground">
          You haven't hired anyone yet. Bring on your first teammate to start
          chatting.
        </p>
        <Button
          type="button"
          onClick={() => {
            onOpenChange(false)
            setHireOpen(true)
          }}
        >
          <UserPlus className="size-4" />
          Hire your first teammate
        </Button>
      </div>
      <HireDialog open={hireOpen} onOpenChange={setHireOpen} />
    </>
  )
}
