/**
 * Per-org signed webhook ingress — OpenClaw webhooks parity.
 * Enqueues inbound payloads to the same chat runner path as channels.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export type OrgWebhookPayload = {
  message: string;
  threadKey?: string;
  metadata?: Record<string, unknown>;
};

export type OrgWebhookDeps = {
  orgId: string;
  secret: string;
  chatRunner: (req: {
    orgId: string;
    threadKey: string;
    message: string;
    metadata?: Record<string, unknown>;
  }) => Promise<{ replyText?: string }>;
  maxBodyBytes?: number;
  /** Optional: reject replays older than skew window */
  maxTimestampSkewSec?: number;
};

const DEFAULT_MAX_BODY = 256 * 1024;
const SIGNATURE_HEADER = "x-oweb-signature";
const TIMESTAMP_HEADER = "x-oweb-timestamp";

export function buildOrgWebhookUrl(baseUrl: string, orgId: string, webhookId: string): string {
  const base = baseUrl.replace(/\/$/, "");
  return `${base}/api/webhooks/org/${encodeURIComponent(orgId)}/${encodeURIComponent(webhookId)}`;
}

export function signOrgWebhookPayload(
  secret: string,
  timestamp: string,
  body: string,
): string {
  const digest = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  return `sha256=${digest}`;
}

export function verifyOrgWebhookSignature(
  secret: string,
  timestamp: string,
  body: string,
  signature: string,
): boolean {
  const expected = signOrgWebhookPayload(secret, timestamp, body);
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function parseOrgWebhookPayload(raw: string): OrgWebhookPayload {
  const parsed = JSON.parse(raw) as OrgWebhookPayload;
  if (!parsed.message || typeof parsed.message !== "string") {
    throw new Error("message is required");
  }
  return parsed;
}

export async function handleOrgWebhook(request: Request, deps: OrgWebhookDeps): Promise<Response> {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const maxBody = deps.maxBodyBytes ?? DEFAULT_MAX_BODY;
  const raw = await request.text();
  if (raw.length > maxBody) {
    return new Response("Payload too large", { status: 413 });
  }

  const timestamp = request.headers.get(TIMESTAMP_HEADER) ?? "";
  const signature = request.headers.get(SIGNATURE_HEADER) ?? "";
  if (!timestamp || !signature) {
    return new Response("Missing signature headers", { status: 401 });
  }

  const skew = deps.maxTimestampSkewSec ?? 300;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > skew) {
    return new Response("Timestamp out of range", { status: 401 });
  }

  if (!verifyOrgWebhookSignature(deps.secret, timestamp, raw, signature)) {
    return new Response("Invalid signature", { status: 401 });
  }

  let payload: OrgWebhookPayload;
  try {
    payload = parseOrgWebhookPayload(raw);
  } catch (err) {
    return new Response(err instanceof Error ? err.message : "Invalid payload", { status: 400 });
  }

  const threadKey = payload.threadKey ?? `webhook:${deps.orgId}:default`;

  void (async () => {
    try {
      await deps.chatRunner({
        orgId: deps.orgId,
        threadKey,
        message: payload.message,
        metadata: payload.metadata,
      });
    } catch (err) {
      console.error("[org-webhook] chat runner failed", err);
    }
  })();

  return Response.json({ accepted: true });
}
