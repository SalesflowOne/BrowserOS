import { api } from '../api/client'
import { parseResponse } from '../api/parseResponse'

const $pick = api.system['pick-directory'].$post

/**
 * Opens the host's native folder picker via the Hono route in main.
 * Returns the absolute path the user chose, or `null` when they
 * dismissed the panel. Wrapped here (rather than as a react-query
 * mutation) because the call is one-shot and there's nothing for
 * the renderer to cache.
 */
export async function pickDirectory(): Promise<string | null> {
  const res = await $pick().then(parseResponse<{ path: string | null }>)
  return res.path
}
