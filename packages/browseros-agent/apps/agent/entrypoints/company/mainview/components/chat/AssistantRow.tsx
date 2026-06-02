import { Avatar } from '@company/components/chat/Avatar'
import type { Tint } from '@company/lib/tints'
import type { Status } from '@company/lib/types'
import { cn } from '@company/lib/utils'
import type { FC, ReactNode } from 'react'

export interface EmployeeFace {
  id: string
  monogram: string
  tint: Tint
  status?: Status
  name: string
}

// Wraps assistant-side content with a fixed avatar gutter on the left.
// `showAvatar` keeps the gutter present but invisible on continuation
// rows so the conversation column stays aligned.
export const AssistantRow: FC<{
  employee: EmployeeFace
  showAvatar: boolean
  children: ReactNode
}> = ({ employee, showAvatar, children }) => (
  <div className="flex w-full items-start gap-3">
    <span
      className={cn(
        'flex size-7 shrink-0 items-center justify-center',
        // text-sm line is ~20px; centering inside a 20px box aligns the
        // avatar's optical middle with the first line's cap height
        // without dragging it down on multi-line messages.
        'h-5',
        !showAvatar && 'invisible',
      )}
    >
      <Avatar monogram={employee.monogram} tint={employee.tint} size="sm" />
    </span>
    <div className="min-w-0 flex-1">{children}</div>
  </div>
)
