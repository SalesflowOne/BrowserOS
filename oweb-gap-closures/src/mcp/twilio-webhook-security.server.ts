/**
 * Twilio webhook signature verification.
 * Adapted from OpenClaw voice-call/src/webhook-security.ts (HMAC-SHA1).
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export function buildTwilioDataToSign(url: string, params: URLSearchParams): string {
  let data = url;
  const sorted = [...params.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  for (const [key, value] of sorted) data += key + value;
  return data;
}

export function validateTwilioSignature(
  authToken: string,
  signature: string | undefined,
  url: string,
  params: URLSearchParams,
): boolean {
  if (!signature) return false;
  const expected = createHmac("sha1", authToken)
    .update(buildTwilioDataToSign(url, params))
    .digest("base64");
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function parseTwilioFormBody(raw: string): URLSearchParams {
  return new URLSearchParams(raw);
}
