import { type Tint, tintTokens } from '@company/lib/tints'
import type { Status } from '@company/lib/types'
import { cn } from '@company/lib/utils'
import type { CSSProperties, FC } from 'react'

interface Props {
  monogram: string
  tint: Tint
  status?: Status
  size?: 'xs' | 'sm' | 'md' | 'lg'
  ringed?: boolean
  className?: string
}

const SIZE: Record<
  NonNullable<Props['size']>,
  { box: string; text: string; dot: string }
> = {
  xs: { box: 'size-5', text: 'text-[9px]', dot: 'size-1.5' },
  sm: { box: 'size-7', text: 'text-[10.5px]', dot: 'size-2.5' },
  md: { box: 'size-9', text: 'text-[12px]', dot: 'size-3' },
  lg: { box: 'size-12', text: 'text-[15px]', dot: 'size-3.5' },
}

// Dot colour per rail status. Working stays the existing green; idle
// stays the existing amber; offline stays gray. The two new states:
//   - pending: warmer amber tilted toward orange, paired with a pulse
//     animation so "request in flight" reads as motion.
//   - attention: cool blue, no animation — "look at this when you have
//     a moment," not "this is happening right now."
//   - awaiting_approval: reserved enum slot; renders idle for now until
//     the follow-up that wires the priority + colour decides.
const STATUS_COLOR: Record<Status, string> = {
  working: 'oklch(0.72 0.16 145)',
  pending: 'oklch(0.78 0.16 65)',
  attention: 'oklch(0.66 0.18 250)',
  idle: 'oklch(0.78 0.06 85)',
  offline: 'oklch(0.62 0 0)',
  awaiting_approval: 'oklch(0.78 0.06 85)',
}

// Statuses that animate the dot. Today only `pending` pulses — the
// signal "we're waiting for the model to start streaming" benefits
// from motion, while `working` already has visible activity (text
// streaming) and `attention` is a passive notification.
const PULSING_STATUSES: ReadonlySet<Status> = new Set(['pending'])

export const Avatar: FC<Props> = ({
  monogram,
  tint,
  status,
  size = 'md',
  ringed,
  className,
}) => {
  const t = tintTokens(tint)
  const s = SIZE[size]
  const style: CSSProperties = {
    backgroundColor: t.bg,
    color: t.fg,
    backgroundImage: `linear-gradient(140deg, ${t.soft} 0%, ${t.bg} 55%, ${t.ring} 130%)`,
    boxShadow: `inset 0 0 0 1px color-mix(in oklch, ${t.fg} 14%, transparent), inset 0 1px 0 color-mix(in oklch, white 35%, transparent)`,
  }
  const pulses = status ? PULSING_STATUSES.has(status) : false
  return (
    <span className={cn('relative inline-flex shrink-0', className)}>
      <span
        style={style}
        className={cn(
          'inline-flex items-center justify-center rounded-full font-mono font-semibold uppercase tracking-tight',
          s.box,
          s.text,
          ringed && 'ring-2 ring-offset-1 ring-offset-background',
        )}
      >
        {monogram.slice(0, 2)}
      </span>
      {status ? (
        <span
          aria-hidden="true"
          style={{ backgroundColor: STATUS_COLOR[status] }}
          className={cn(
            'absolute right-0 bottom-0 rounded-full shadow-sm ring-[2.5px] ring-background',
            s.dot,
            pulses && 'animate-pulse',
          )}
        />
      ) : null}
    </span>
  )
}
