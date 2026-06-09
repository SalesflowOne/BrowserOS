import type { FC, PointerEventHandler } from 'react'
import { BrowserOSIcon } from '@/lib/llm-providers/providerIcons'
import type { LauncherPosition } from './content-script.types'
import { LAUNCHER_SIZE } from './content-script.types'

interface FaLaunchProps {
  position: LauncherPosition
  live?: boolean
  badgeLive?: boolean
  onPointerDown: PointerEventHandler<HTMLButtonElement>
}

export const FaLaunch: FC<FaLaunchProps> = ({
  position,
  live = true,
  badgeLive = true,
  onPointerDown,
}) => (
  <button
    type="button"
    aria-label="Open BrowserOS chat"
    onPointerDown={onPointerDown}
    style={{
      left: position.x,
      top: position.y,
      width: LAUNCHER_SIZE,
      height: LAUNCHER_SIZE,
      touchAction: 'none',
    }}
    className="fixed z-[2147483646] flex cursor-grab items-center justify-center rounded-full border-0 bg-white p-0 shadow-[0_8px_24px_-4px_rgba(40,40,60,0.28),0_0_0_1px_rgba(0,0,0,0.05)] transition-[box-shadow,transform] duration-150 hover:-translate-y-px hover:shadow-[0_10px_30px_-4px_rgba(40,40,60,0.34),0_0_0_1px_rgba(0,0,0,0.06)] active:scale-[0.96] active:cursor-grabbing"
  >
    <BrowserOSIcon size={28} />
    {live && (
      <span
        aria-hidden
        className="pointer-events-none absolute -inset-[5px] animate-[fa-ring_1.9s_ease-out_infinite] rounded-full border-2 border-[#4285F4] opacity-50"
      />
    )}
    <span
      aria-hidden
      className={
        badgeLive
          ? 'absolute top-px right-px size-[11px] animate-[fv-pulse_1.4s_ease-in-out_infinite] rounded-full bg-[var(--accent-orange)] ring-2 ring-white'
          : 'absolute top-px right-px size-[11px] rounded-full bg-[var(--muted-foreground)] ring-2 ring-white'
      }
    />
  </button>
)
