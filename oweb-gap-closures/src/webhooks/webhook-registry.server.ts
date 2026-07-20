/**
 * Multi-route org webhook registry with rate limiting and bearer fallback.
 * Patterns from OpenClaw webhooks extension.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

import { createFixedWindowRateLimiter } from "../lib/rate-limit.js";
import {
  handleOrgWebhook,
  signOrgWebhookPayload,
  verifyOrgWebhookSignature,
  type OrgWebhookDeps,
  type OrgWebhookPayload,
} from "./org-webhooks.server.js";

export type WebhookRouteConfig = {
  id: string;
  orgId: string;
  secret: string;
  threadKey?: string;
  enabled?: boolean;
};

export type WebhookRegistryDeps = {
  getRoute: (orgId: string, routeId: string) => Promise<WebhookRouteConfig | null>;
  chatRunner: OrgWebhookDeps["chatRunner"];
  rateLimitPerMinute?: number;
};

const BEARER_PREFIX = "Bearer ";
const SIGNATURE_HEADER = "x-oweb-signature";
const TIMESTAMP_HEADER = "x-oweb-timestamp";

export function extractBearerSecret(request: Request): string | null {
  const auth = request.headers.get("authorization");
  if (!auth?.startsWith(BEARER_PREFIX)) return null;
  return auth.slice(BEARER_PREFIX.length).trim() || null;
}

export function verifyWebhookAuth(
  request: Request,
  secret: string,
  raw: string,
): { ok: true } | { ok: false; reason: string } {
  const bearer = extractBearerSecret(request);
  if (bearer) {
    const a = Buffer.from(bearer);
    const b = Buffer.from(secret);
    if (a.length === b.length && timingSafeEqual(a, b)) return { ok: true };
    return { ok: false, reason: "Invalid bearer token" };
  }

  const timestamp = request.headers.get(TIMESTAMP_HEADER) ?? "";
  const signature = request.headers.get(SIGNATURE_HEADER) ?? "";
  if (!timestamp || !signature) {
    return { ok: false, reason: "Missing signature headers" };
  }

  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 300) {
    return { ok: false, reason: "Timestamp out of range" };
  }

  if (!verifyOrgWebhookSignature(secret, timestamp, raw, signature)) {
    return { ok: false, reason: "Invalid signature" };
  }

  return { ok: true };
}

export async function handleRegistryWebhook(
  request: Request,
  orgId: string,
  routeId: string,
  deps: WebhookRegistryDeps,
): Promise<Response> {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const route = await deps.getRoute(orgId, routeId);
  if (!route || route.enabled === false) {
    return new Response("Not found", { status: 404 });
  }

  const limiter = createFixedWindowRateLimiter({
    maxRequests: deps.rateLimitPerMinute ?? 120,
    windowMs: 60_000,
  });
  const limited = limiter(`${orgId}:${routeId}`);
  if (!limited.allowed) {
    return new Response("Rate limit exceeded", { status: 429 });
  }

  const raw = await request.text();
  const auth = verifyWebhookAuth(request, route.secret, raw);
  if (!auth.ok) {
    return new Response(auth.reason, { status: 401 });
  }

  let payload: OrgWebhookPayload;
  try {
    payload = JSON.parse(raw) as OrgWebhookPayload;
    if (!payload.message) throw new Error("message is required");
  } catch (err) {
    return new Response(err instanceof Error ? err.message : "Invalid payload", { status: 400 });
  }

  const threadKey = payload.threadKey ?? route.threadKey ?? `webhook:${orgId}:${routeId}`;

  void deps.chatRunner({
    orgId,
    threadKey,
    message: payload.message,
    metadata: payload.metadata,
  });

  return Response.json({ accepted: true, routeId });
}

export { signOrgWebhookPayload };
