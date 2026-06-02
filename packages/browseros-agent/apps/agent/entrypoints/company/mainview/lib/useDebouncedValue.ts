import { useEffect, useState } from 'react'

// Returns the latest `value` after it's held steady for `delay` ms.
// Used by the search palette to keep the network quiet while the
// user is mid-keystroke. Pulls value into local state on the
// trailing edge of the debounce window; the timer resets on every
// new value and clears on unmount.
export function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(id)
  }, [value, delay])
  return debounced
}
