export type ApiBaseUrlSources = {
  query: string | null | undefined
  stored: string | null | undefined
  launcher: string | null | undefined
  fallback: string
}

export const API_URL_STORAGE_KEY = 'browseros.agent-mcp-ui.apiUrl'

export function isLoopbackUrl(
  value: string | null | undefined,
): value is string {
  return !!value && value.startsWith('http://127.0.0.1:')
}

/** Resolves the cockpit API URL from trusted local dev sources. */
export function resolveApiBaseUrlFromSources(
  sources: ApiBaseUrlSources,
): string {
  if (isLoopbackUrl(sources.query)) return sources.query
  if (isLoopbackUrl(sources.stored)) return sources.stored
  if (isLoopbackUrl(sources.launcher)) return sources.launcher
  return sources.fallback
}
