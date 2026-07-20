/**
 * WhatsApp channel via Twilio Messaging API (no Baileys / WhatsApp Web).
 * Pattern adapted from OpenClaw whatsapp admission + OWeb telegram channel.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

import type { ChannelInboundMessage, ChatRunner, ChatRunnerResult } from "./channel-types.js";
import { createFixedWindowRateLimiter } from "../lib/rate-limit.js";

export type TwilioWhatsAppConfig = {
  orgId: string;
  accountSid: string;
  authToken: string;
  /** Twilio WhatsApp sender, e.g. whatsapp:+14155238886 */
  fromWhatsApp: string;
};

export type TwilioWhatsAppWebhookDeps = {
  config: TwilioWhatsAppConfig;
  chatRunner: ChatRunner;
  rateLimit?: ReturnType<typeof createFixedWindowRateLimiter>;
};

type TwilioSmsWebhookBody = {
  MessageSid?: string;
  AccountSid?: string;
  From?: string;
  To?: string;
  Body?: string;
  NumMedia?: string;
  ProfileName?: string;
};

function parseTwilioFormBody(raw: string): TwilioSmsWebhookBody {
  const params = new URLSearchParams(raw);
  return {
    MessageSid: params.get("MessageSid") ?? undefined,
    AccountSid: params.get("AccountSid") ?? undefined,
    From: params.get("From") ?? undefined,
    To: params.get("To") ?? undefined,
    Body: params.get("Body") ?? undefined,
    NumMedia: params.get("NumMedia") ?? undefined,
    ProfileName: params.get("ProfileName") ?? undefined,
  };
}

export function normalizeWhatsAppInbound(body: TwilioSmsWebhookBody): ChannelInboundMessage | null {
  const from = body.From;
  const text = body.Body?.trim();
  if (!from?.startsWith("whatsapp:") || !text) return null;

  const phone = from.replace(/^whatsapp:/, "");
  return {
    channel: "whatsapp" as ChannelInboundMessage["channel"],
    externalThreadId: phone,
    externalUserId: phone,
    externalMessageId: body.MessageSid ?? `wa_${Date.now()}`,
    text,
    displayName: body.ProfileName,
    raw: body,
  };
}

function twilioAuthHeader(config: TwilioWhatsAppConfig): string {
  const creds = Buffer.from(`${config.accountSid}:${config.authToken}`).toString("base64");
  return `Basic ${creds}`;
}

export async function sendWhatsAppTwilioMessage(
  config: TwilioWhatsAppConfig,
  toPhone: string,
  text: string,
): Promise<{ sid: string }> {
  const to = toPhone.startsWith("whatsapp:") ? toPhone : `whatsapp:${toPhone}`;
  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${config.accountSid}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: twilioAuthHeader(config),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        From: config.fromWhatsApp,
        To: to,
        Body: text,
      }).toString(),
    },
  );
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Twilio WhatsApp send failed: ${res.status} ${err}`);
  }
  const json = (await res.json()) as { sid: string };
  return { sid: json.sid };
}

export function buildWhatsAppWebhookPath(orgId: string): string {
  return `/api/channels/whatsapp/webhook?org=${encodeURIComponent(orgId)}`;
}

export async function handleWhatsAppTwilioWebhook(
  request: Request,
  deps: TwilioWhatsAppWebhookDeps,
): Promise<Response> {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const limiter = deps.rateLimit ?? createFixedWindowRateLimiter({ maxRequests: 60, windowMs: 60_000 });
  const limitKey = `wa:${deps.config.orgId}`;
  const limited = limiter(limitKey);
  if (!limited.allowed) {
    return new Response("Rate limit exceeded", {
      status: 429,
      headers: { "Retry-After": String(Math.ceil(limited.retryAfterMs / 1000)) },
    });
  }

  const raw = await request.text();
  const body = parseTwilioFormBody(raw);

  if (body.AccountSid && body.AccountSid !== deps.config.accountSid) {
    return new Response("Forbidden", { status: 403 });
  }

  const inbound = normalizeWhatsAppInbound(body);
  if (!inbound) {
    return twimlEmptyResponse();
  }

  const threadKey = `whatsapp:${deps.config.orgId}:${inbound.externalThreadId}`;

  void (async () => {
    try {
      const result: ChatRunnerResult = await deps.chatRunner({
        orgId: deps.config.orgId,
        threadKey,
        inbound,
      });
      if (!result.skipOutbound && result.replyText.trim()) {
        await sendWhatsAppTwilioMessage(
          deps.config,
          inbound.externalThreadId,
          result.replyText,
        );
      }
    } catch (err) {
      console.error("[whatsapp-channel] chat runner failed", err);
    }
  })();

  return twimlEmptyResponse();
}

function twimlEmptyResponse(): Response {
  return new Response('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', {
    status: 200,
    headers: { "Content-Type": "text/xml" },
  });
}

/** Verify Twilio request signature (pattern from OpenClaw voice-call webhook-security). */
export function verifyTwilioRequestSignature(
  authToken: string,
  signature: string | null,
  url: string,
  params: URLSearchParams,
): boolean {
  if (!signature) return false;
  let data = url;
  const sorted = [...params.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  for (const [k, v] of sorted) data += k + v;
  const expected = createHmac("sha1", authToken).update(data).digest("base64");
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
