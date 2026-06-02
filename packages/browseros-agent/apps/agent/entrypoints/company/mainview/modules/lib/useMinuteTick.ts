import { useEffect, useState } from 'react'

// One shared interval drives every relative-time row in the rail.
// Per-row setInterval would scale to N timers as employees + threads
// grow; this keeps the cost flat. Subscriber counting lets the timer
// stop when nothing is mounted that needs it.

let subscribers = 0
let timer: ReturnType<typeof setInterval> | null = null
const listeners = new Set<() => void>()

function ensureTimer(): void {
  if (timer) return
  timer = setInterval(() => {
    for (const listener of listeners) listener()
  }, 60_000)
}

function teardownTimer(): void {
  if (!timer) return
  clearInterval(timer)
  timer = null
}

export function useMinuteTick(): number {
  const [tick, setTick] = useState(0)

  useEffect(() => {
    const listener = () => setTick((t) => t + 1)
    listeners.add(listener)
    subscribers += 1
    ensureTimer()
    return () => {
      listeners.delete(listener)
      subscribers -= 1
      if (subscribers === 0) teardownTimer()
    }
  }, [])

  return tick
}
