import { X } from 'lucide-react'
import type { FC } from 'react'
import { ChatLayoutShell } from './ChatLayoutShell'
import { LAUNCHER_SIZE, type LauncherPosition } from './content-script.types'

interface FaPopupProps {
  anchor: LauncherPosition
  onClose: () => void
}

const POPUP_WIDTH = 380
const POPUP_HEIGHT = 520
const POPUP_GAP = 12

function popupAnchor(anchor: LauncherPosition): { left: number; top: number } {
  const launcherCenterX = anchor.x + LAUNCHER_SIZE / 2
  const proposedLeft = launcherCenterX - POPUP_WIDTH / 2
  const left = Math.min(
    Math.max(12, proposedLeft),
    Math.max(12, window.innerWidth - POPUP_WIDTH - 12),
  )
  const proposedTop = anchor.y - POPUP_HEIGHT - POPUP_GAP
  const top =
    proposedTop > 12 ? proposedTop : anchor.y + LAUNCHER_SIZE + POPUP_GAP
  return { left, top }
}

export const FaPopup: FC<FaPopupProps> = ({ anchor, onClose }) => {
  const { left, top } = popupAnchor(anchor)
  return (
    <div
      className="fixed z-[2147483647] flex flex-col overflow-hidden rounded-[18px] bg-background shadow-[0_28px_70px_-16px_rgba(30,30,50,0.40),0_0_0_1px_rgba(0,0,0,0.06)]"
      style={{ left, top, width: POPUP_WIDTH, height: POPUP_HEIGHT }}
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Close BrowserOS chat"
        className="absolute top-[11px] right-3 z-[3] inline-flex size-7 cursor-pointer items-center justify-center rounded-lg border-0 bg-transparent text-muted-foreground transition-colors duration-100 hover:bg-accent hover:text-foreground"
      >
        <X className="size-4" aria-hidden />
      </button>
      <ChatLayoutShell />
    </div>
  )
}
