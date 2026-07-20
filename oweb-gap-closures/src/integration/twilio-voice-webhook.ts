/**
 * Twilio Voice webhook handlers — status callbacks + TwiML endpoints.
 */
import { validateTwilioSignature, parseTwilioFormBody } from "../mcp/twilio-webhook-security.server.js";
import { twimlResponse, twimlSay } from "../mcp/twiml.server.js";
import type { TwilioVoiceConfig } from "../mcp/twilio-voice.server.js";

export type TwilioVoiceWebhookDeps = {
  config: TwilioVoiceConfig;
  /** Reconstruct public URL for signature validation */
  getWebhookUrl: (request: Request) => string;
  onCallStatus?: (event: {
    callSid: string;
    status: string;
    from?: string;
    to?: string;
  }) => void | Promise<void>;
  /** Dynamic TwiML greeting for outbound calls */
  getGreeting?: () => string;
};

export async function handleTwilioVoiceStatusWebhook(
  request: Request,
  deps: TwilioVoiceWebhookDeps,
): Promise<Response> {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const raw = await request.text();
  const params = parseTwilioFormBody(raw);
  const signature = request.headers.get("x-twilio-signature");
  const url = deps.getWebhookUrl(request);

  if (
    !validateTwilioSignature(deps.config.authToken, signature ?? undefined, url, params)
  ) {
    return new Response("Invalid signature", { status: 403 });
  }

  const callSid = params.get("CallSid") ?? "";
  const status = params.get("CallStatus") ?? "";
  const from = params.get("From") ?? undefined;
  const to = params.get("To") ?? undefined;

  if (callSid && deps.onCallStatus) {
    void deps.onCallStatus({ callSid, status, from, to });
  }

  return new Response("", { status: 200 });
}

export async function handleTwilioVoiceTwimlWebhook(
  _request: Request,
  deps: TwilioVoiceWebhookDeps,
): Promise<Response> {
  const greeting = deps.getGreeting?.() ?? "Hello. This is your OWeb assistant.";
  return twimlResponse(twimlSay(greeting));
}

export function buildTwilioVoiceWebhookPaths(orgId: string) {
  return {
    status: `/api/voice/twilio/status?org=${encodeURIComponent(orgId)}`,
    twiml: `/api/voice/twilio/twiml?org=${encodeURIComponent(orgId)}`,
  };
}
