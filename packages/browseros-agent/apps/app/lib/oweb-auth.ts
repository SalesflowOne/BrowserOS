/**
 * OWeb Browser auth client — apply in BrowserOS agent fork.
 * Mirrors extensions/chrome-nanobrowser chrome-extension/src/background/services/owebAuth.ts
 */
import {
  OWEB_API_BASE,
  OWEB_APP_ORIGIN,
  OWEB_AUTH_PATH,
  OWEB_DEFAULT_MODEL,
} from "./oweb-config";

export type OWebOrg = {
  id: string;
  name: string;
  slug: string;
  plan: string | null;
  role: string;
  credits_balance: number;
};

export type OWebAuthSession = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number | null;
  userId: string;
  email: string | null;
  activeOrgId: string | null;
  orgs: OWebOrg[];
  updatedAt: number;
};

type SessionResponse = {
  user: { id: string; email: string | null };
  orgs: OWebOrg[];
  activeOrgId: string | null;
  client?: string;
};

const SESSION_KEY = "oweb_browser_session_v1";

export function parseAuthRedirectUrl(redirectedTo: string): {
  access_token: string;
  refresh_token: string;
  expires_at?: number;
} {
  const url = new URL(redirectedTo);
  const hash = url.hash.startsWith("#") ? url.hash.slice(1) : url.hash;
  const params = new URLSearchParams(hash || url.search);
  const access_token = params.get("access_token") || "";
  const refresh_token = params.get("refresh_token") || "";
  const expires_at_raw = params.get("expires_at");
  if (!access_token || !refresh_token) {
    throw new Error("Sign-in did not return tokens. Try again.");
  }
  return {
    access_token,
    refresh_token,
    expires_at: expires_at_raw ? Number(expires_at_raw) : undefined,
  };
}

export async function fetchOwebSession(accessToken: string): Promise<SessionResponse> {
  const res = await fetch(`${OWEB_APP_ORIGIN}/api/browser/v1/session`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(body || `Session failed (${res.status})`);
  }
  return (await res.json()) as SessionResponse;
}

export function getStoredSession(): OWebAuthSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as OWebAuthSession;
  } catch {
    return null;
  }
}

export function storeSession(session: OWebAuthSession): void {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function clearStoredSession(): void {
  localStorage.removeItem(SESSION_KEY);
}

export async function applyOwebSession(tokens: {
  access_token: string;
  refresh_token: string;
  expires_at?: number;
}): Promise<OWebAuthSession> {
  const sessionInfo = await fetchOwebSession(tokens.access_token);
  const stored: OWebAuthSession = {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: tokens.expires_at ?? null,
    userId: sessionInfo.user.id,
    email: sessionInfo.user.email,
    activeOrgId: sessionInfo.activeOrgId,
    orgs: sessionInfo.orgs,
    updatedAt: Date.now(),
  };
  storeSession(stored);
  return stored;
}

/** Build sign-in URL — browser opens this in system browser or webview. */
export function buildOwebAuthUrl(redirectUri: string): string {
  const authUrl = new URL(OWEB_AUTH_PATH, OWEB_APP_ORIGIN);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  return authUrl.toString();
}

/** Default OWeb LLM provider settings for BrowserOS agent server. */
export function buildOwebLlmProviderConfig(accessToken: string, orgId?: string | null) {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
  };
  if (orgId) headers["X-OWeb-Org-Id"] = orgId;
  return {
    provider: "oweb",
    baseUrl: OWEB_API_BASE,
    apiKey: accessToken,
    model: OWEB_DEFAULT_MODEL,
    headers,
  };
}

export async function refreshOwebSessionIfNeeded(): Promise<OWebAuthSession | null> {
  const session = getStoredSession();
  if (!session) return null;
  try {
    const info = await fetchOwebSession(session.accessToken);
    const next: OWebAuthSession = {
      ...session,
      userId: info.user.id,
      email: info.user.email,
      orgs: info.orgs,
      activeOrgId:
        session.activeOrgId && info.orgs.some((o) => o.id === session.activeOrgId)
          ? session.activeOrgId
          : info.activeOrgId,
      updatedAt: Date.now(),
    };
    storeSession(next);
    return next;
  } catch {
    clearStoredSession();
    return null;
  }
}
