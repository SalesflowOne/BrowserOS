import {
  createContext,
  type FC,
  type PointerEventHandler,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react'
import { storage } from '#imports'
import {
  DRAG_THRESHOLD,
  LAUNCHER_SIZE,
  type LauncherPosition,
  STORAGE_KEY_POPUP_OPEN,
  STORAGE_KEY_POSITION,
  VIEWPORT_MARGIN,
} from './content-script.types'

interface LauncherStateContextValue {
  position: LauncherPosition
  popupOpen: boolean
  beginDrag: PointerEventHandler<HTMLButtonElement>
  closePopup: () => void
}

const LauncherStateContext = createContext<LauncherStateContextValue | null>(
  null,
)

function defaultPosition(): LauncherPosition {
  const x = Math.max(VIEWPORT_MARGIN, window.innerWidth - LAUNCHER_SIZE - 24)
  const y = Math.max(VIEWPORT_MARGIN, window.innerHeight - LAUNCHER_SIZE - 24)
  return { x, y }
}

function clamp(pos: LauncherPosition): LauncherPosition {
  const maxX = window.innerWidth - LAUNCHER_SIZE - VIEWPORT_MARGIN
  const maxY = window.innerHeight - LAUNCHER_SIZE - VIEWPORT_MARGIN
  return {
    x: Math.min(
      Math.max(VIEWPORT_MARGIN, pos.x),
      Math.max(VIEWPORT_MARGIN, maxX),
    ),
    y: Math.min(
      Math.max(VIEWPORT_MARGIN, pos.y),
      Math.max(VIEWPORT_MARGIN, maxY),
    ),
  }
}

const positionItem = storage.defineItem<LauncherPosition | null>(
  `local:${STORAGE_KEY_POSITION}`,
  { fallback: null },
)
const popupOpenItem = storage.defineItem<boolean>(
  `local:${STORAGE_KEY_POPUP_OPEN}`,
  { fallback: false },
)

export const LauncherStateProvider: FC<{ children: ReactNode }> = ({
  children,
}) => {
  const [position, setPosition] = useState<LauncherPosition>(defaultPosition)
  const [popupOpen, setPopupOpen] = useState<boolean>(false)
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    let cancelled = false
    Promise.all([positionItem.getValue(), popupOpenItem.getValue()]).then(
      ([storedPos, storedOpen]) => {
        if (cancelled) return
        if (storedPos) setPosition(clamp(storedPos))
        setPopupOpen(storedOpen)
        setHydrated(true)
      },
    )
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!hydrated) return
    void positionItem.setValue(position)
  }, [position, hydrated])

  useEffect(() => {
    if (!hydrated) return
    void popupOpenItem.setValue(popupOpen)
  }, [popupOpen, hydrated])

  const dragStateRef = useRef<{
    startX: number
    startY: number
    originX: number
    originY: number
    moved: boolean
    pointerId: number
  } | null>(null)

  const beginDrag: PointerEventHandler<HTMLButtonElement> = (event) => {
    const target = event.currentTarget
    target.setPointerCapture(event.pointerId)
    dragStateRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      originX: position.x,
      originY: position.y,
      moved: false,
      pointerId: event.pointerId,
    }

    const handleMove = (move: PointerEvent) => {
      const drag = dragStateRef.current
      if (!drag || move.pointerId !== drag.pointerId) return
      const dx = move.clientX - drag.startX
      const dy = move.clientY - drag.startY
      if (!drag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return
      drag.moved = true
      setPosition(clamp({ x: drag.originX + dx, y: drag.originY + dy }))
    }

    const handleUp = (up: PointerEvent) => {
      const drag = dragStateRef.current
      if (!drag || up.pointerId !== drag.pointerId) return
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleUp)
      window.removeEventListener('pointercancel', handleUp)
      dragStateRef.current = null
      if (!drag.moved) {
        setPopupOpen((open) => !open)
      }
    }

    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleUp)
    window.addEventListener('pointercancel', handleUp)
  }

  const closePopup = () => setPopupOpen(false)

  return (
    <LauncherStateContext.Provider
      value={{ position, popupOpen, beginDrag, closePopup }}
    >
      {children}
    </LauncherStateContext.Provider>
  )
}

export const useLauncherState = (): LauncherStateContextValue => {
  const ctx = useContext(LauncherStateContext)
  if (!ctx) {
    throw new Error(
      'useLauncherState must be used inside <LauncherStateProvider>',
    )
  }
  return ctx
}
