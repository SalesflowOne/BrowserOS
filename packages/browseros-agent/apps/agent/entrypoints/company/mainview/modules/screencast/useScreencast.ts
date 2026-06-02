import { type RefObject, useEffect, useRef, useState } from 'react'
import { API_BASE_URL } from '../api/client'

export type ScreencastStatus =
  | 'idle'
  | 'connecting'
  | 'live'
  | 'reconnecting'
  | 'closed'

export interface UseScreencastResult {
  status: ScreencastStatus
  currentUrl: string | null
}

interface FrameMessage {
  type: 'frame'
  data: string
}

interface StatusMessage {
  type: 'status'
  status: 'connected' | 'detached'
  windowId: number
  url?: string
}

type Inbound = FrameMessage | StatusMessage

export function useScreencast(
  windowId: number | null,
  pageId: number | null,
  canvasRef: RefObject<HTMLCanvasElement | null>,
): UseScreencastResult {
  const [status, setStatus] = useState<ScreencastStatus>('idle')
  const [currentUrl, setCurrentUrl] = useState<string | null>(null)
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null)

  useEffect(() => {
    // Clear the stale frame from any prior subscription so surface
    // swaps don't briefly show the old tab under the new overlay.
    const canvas = canvasRef.current
    if (canvas) {
      ctxRef.current = canvas.getContext('2d')
      ctxRef.current?.clearRect(0, 0, canvas.width, canvas.height)
    }
    // Idle when there's no specific page to follow. We deliberately
    // don't fall back to the window's active tab — that surfaces an
    // unrelated surface's content under this pane.
    if (windowId === null || pageId === null) {
      setStatus('idle')
      setCurrentUrl(null)
      return
    }
    setStatus('connecting')
    setCurrentUrl(null)

    const url = `${API_BASE_URL}/screencast/${windowId}?pageId=${encodeURIComponent(String(pageId))}`
    const source = new EventSource(url)
    let closed = false

    const handleFrame = (event: MessageEvent) => {
      if (closed) return
      let parsed: Inbound
      try {
        parsed = JSON.parse(event.data) as Inbound
      } catch {
        return
      }
      if (parsed.type !== 'frame') return
      paintFrame(canvasRef.current, ctxRef.current, parsed.data, () => closed)
    }

    const handleStatus = (event: MessageEvent) => {
      if (closed) return
      let parsed: Inbound
      try {
        parsed = JSON.parse(event.data) as Inbound
      } catch {
        return
      }
      if (parsed.type !== 'status') return
      setStatus(parsed.status === 'connected' ? 'live' : 'closed')
      if (parsed.url !== undefined) {
        setCurrentUrl(parsed.url)
      }
    }

    const handleError = () => {
      if (closed) return
      setStatus((prev) =>
        prev === 'live' || prev === 'connecting' ? 'reconnecting' : prev,
      )
    }

    source.addEventListener('frame', handleFrame)
    source.addEventListener('status', handleStatus)
    source.addEventListener('error', handleError)

    return () => {
      closed = true
      source.removeEventListener('frame', handleFrame)
      source.removeEventListener('status', handleStatus)
      source.removeEventListener('error', handleError)
      source.close()
      setStatus('closed')
    }
  }, [windowId, pageId, canvasRef])

  return { status, currentUrl }
}

function paintFrame(
  canvas: HTMLCanvasElement | null,
  ctx: CanvasRenderingContext2D | null,
  base64Jpeg: string,
  isClosed: () => boolean,
): void {
  if (!canvas || !ctx) return
  const binary = atob(base64Jpeg)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  const blob = new Blob([bytes], { type: 'image/jpeg' })
  // createImageBitmap is async; a windowId/pageId change can fire the
  // effect cleanup while it's in flight. Without this guard, a bitmap
  // from the previous stream resizes the canvas + paints over the new
  // stream's first frame.
  void createImageBitmap(blob).then((bitmap) => {
    if (isClosed()) {
      bitmap.close()
      return
    }
    if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
      canvas.width = bitmap.width
      canvas.height = bitmap.height
    }
    ctx.drawImage(bitmap, 0, 0)
    bitmap.close()
  })
}
