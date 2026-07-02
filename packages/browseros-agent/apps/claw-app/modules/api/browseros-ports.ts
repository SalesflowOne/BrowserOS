/// <reference path="./chrome-browser-os.d.ts" />

import { CLAW_API_PORT_DEFAULT } from '@browseros/claw-server/shared/port'
import {
  API_URL_STORAGE_KEY,
  type ApiBaseUrlSources,
  normalizeLoopbackApiRootUrl,
  resolveApiBaseUrlFromSources,
} from './client.helpers'

const BROWSEROS_SERVER_PORT_PREF = 'browseros.server.server_port'
const BROWSEROS_PROXY_PORT_PREF = 'browseros.server.proxy_port'
const PORT_HEALTH_TIMEOUT_MS = 500
const PORT_HEALTH_CACHE_TTL_MS = 2_000
const SYSTEM_HEALTH_PATH = '/system/health'

const portHealthCache = new Map<
  string,
  {
    checkedAt: number
    healthy: boolean
  }
>()

export function fallbackClawApiBaseUrl(): string {
  return `http://127.0.0.1:${CLAW_API_PORT_DEFAULT}`
}

/** Builds trusted fallback sources from the current extension window. */
export function apiBaseUrlSourcesFromWindow(
  fallback = fallbackClawApiBaseUrl(),
): ApiBaseUrlSources {
  if (typeof window === 'undefined') {
    return {
      query: null,
      stored: null,
      launcher: null,
      fallback,
    }
  }

  const query = new URLSearchParams(window.location.search).get('apiUrl')
  const queryBaseUrl = normalizeLoopbackApiRootUrl(query)
  if (queryBaseUrl) {
    try {
      window.sessionStorage.setItem(API_URL_STORAGE_KEY, queryBaseUrl)
    } catch {}
  }

  let stored: string | null = null
  try {
    stored = window.sessionStorage.getItem(API_URL_STORAGE_KEY)
  } catch {}

  return {
    query,
    stored,
    launcher: import.meta.env.VITE_BROWSEROS_CLAW_API_URL,
    fallback,
  }
}

/** Resolves the BrowserOS-managed sidecar server base URL. */
export async function resolveBrowserOSServerBaseUrl(
  sources = apiBaseUrlSourcesFromWindow(),
): Promise<string> {
  const port = await readBrowserOSPort(BROWSEROS_SERVER_PORT_PREF)
  const baseUrl = port ? loopbackBaseUrl(port) : null
  return baseUrl && (await servesClawSystem(baseUrl))
    ? baseUrl
    : resolveApiBaseUrlFromSources(sources)
}

/** Resolves the BrowserOS-managed MCP proxy base URL. */
export async function resolveBrowserOSMcpBaseUrl(
  sources = apiBaseUrlSourcesFromWindow(),
): Promise<string> {
  const port = await readBrowserOSPort(BROWSEROS_PROXY_PORT_PREF)
  const baseUrl = port ? loopbackBaseUrl(port) : null
  return baseUrl && (await servesClawSystem(baseUrl))
    ? baseUrl
    : resolveApiBaseUrlFromSources(sources)
}

/** Clears pref-port readiness cache between isolated test cases. */
export function clearBrowserOSPortHealthCache(): void {
  portHealthCache.clear()
}

async function readBrowserOSPort(prefName: string): Promise<number | null> {
  if (
    typeof chrome === 'undefined' ||
    typeof chrome.browserOS?.getPref !== 'function'
  ) {
    return null
  }

  try {
    const pref = await new Promise<chrome.browserOS.PrefObject>(
      (resolve, reject) => {
        chrome.browserOS.getPref(prefName, (value) => {
          const message = chrome.runtime?.lastError?.message
          if (message) {
            reject(new Error(message))
            return
          }
          resolve(value)
        })
      },
    )
    return validPort(pref.value)
  } catch {
    return null
  }
}

function validPort(value: unknown): number | null {
  if (typeof value !== 'number') return null
  return Number.isInteger(value) && value > 0 && value <= 65535 ? value : null
}

function loopbackBaseUrl(port: number): string {
  return `http://127.0.0.1:${port}`
}

async function servesClawSystem(baseUrl: string): Promise<boolean> {
  const cached = portHealthCache.get(baseUrl)
  if (cached && Date.now() - cached.checkedAt < PORT_HEALTH_CACHE_TTL_MS) {
    return cached.healthy
  }

  const healthy = await probeClawSystem(baseUrl)
  portHealthCache.set(baseUrl, { checkedAt: Date.now(), healthy })
  return healthy
}

async function probeClawSystem(baseUrl: string): Promise<boolean> {
  if (typeof fetch !== 'function') return false

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), PORT_HEALTH_TIMEOUT_MS)
  try {
    const response = await fetch(`${baseUrl}${SYSTEM_HEALTH_PATH}`, {
      cache: 'no-store',
      signal: controller.signal,
    })
    if (!response.ok) return false
    const body = await response.json().catch(() => null)
    return (
      body !== null &&
      typeof body === 'object' &&
      'status' in body &&
      body.status === 'ok'
    )
  } catch {
    return false
  } finally {
    clearTimeout(timeout)
  }
}
