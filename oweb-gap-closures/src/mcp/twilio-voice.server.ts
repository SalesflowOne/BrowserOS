/**
 * Twilio Voice MCP tools — PSTN initiate/end call.
 * Uses Twilio REST API via fetch (no SDK required).
 */

export type TwilioVoiceConfig = {
  accountSid: string;
  authToken: string;
  /** E.164 caller ID, e.g. +15551234567 */
  fromNumber: string;
  /** Public URL Twilio fetches for TwiML when call connects */
  twimlUrl: string;
  /** Optional status callback URL */
  statusCallbackUrl?: string;
};

export type McpToolDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
};

type TwilioCall = {
  sid: string;
  status: string;
  to: string;
  from: string;
};

function twilioAuthHeader(config: TwilioVoiceConfig): string {
  const creds = Buffer.from(`${config.accountSid}:${config.authToken}`).toString("base64");
  return `Basic ${creds}`;
}

async function twilioRequest<T>(
  config: TwilioVoiceConfig,
  path: string,
  body?: Record<string, string>,
): Promise<T> {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${config.accountSid}${path}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: twilioAuthHeader(config),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body ? new URLSearchParams(body).toString() : undefined,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Twilio API error ${res.status}: ${text}`);
  }
  return (await res.json()) as T;
}

export async function initiateTwilioCall(
  config: TwilioVoiceConfig,
  to: string,
): Promise<TwilioCall> {
  const params: Record<string, string> = {
    To: to,
    From: config.fromNumber,
    Url: config.twimlUrl,
  };
  if (config.statusCallbackUrl) {
    params.StatusCallback = config.statusCallbackUrl;
    params.StatusCallbackEvent = "initiated ringing answered completed";
  }
  return twilioRequest<TwilioCall>(config, "/Calls.json", params);
}

export async function endTwilioCall(config: TwilioVoiceConfig, callSid: string): Promise<TwilioCall> {
  return twilioRequest<TwilioCall>(config, `/Calls/${callSid}.json`, { Status: "completed" });
}

export async function getTwilioCallStatus(
  config: TwilioVoiceConfig,
  callSid: string,
): Promise<TwilioCall> {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${config.accountSid}/Calls/${callSid}.json`;
  const res = await fetch(url, {
    headers: { Authorization: twilioAuthHeader(config) },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Twilio API error ${res.status}: ${text}`);
  }
  return (await res.json()) as TwilioCall;
}

export function createTwilioVoiceMcpTools(config: TwilioVoiceConfig): McpToolDefinition[] {
  return [
    {
      name: "initiate_call",
      description: "Place an outbound PSTN phone call via Twilio Voice. Returns call SID.",
      inputSchema: {
        type: "object",
        properties: {
          to: { type: "string", description: "Destination phone number in E.164 format" },
        },
        required: ["to"],
      },
      handler: async (args) => {
        const to = String(args.to ?? "").trim();
        if (!to) throw new Error("to is required");
        const call = await initiateTwilioCall(config, to);
        return { callSid: call.sid, status: call.status, to: call.to, from: call.from };
      },
    },
    {
      name: "end_call",
      description: "End an active Twilio Voice call by SID.",
      inputSchema: {
        type: "object",
        properties: {
          callSid: { type: "string", description: "Twilio Call SID (CA...)" },
        },
        required: ["callSid"],
      },
      handler: async (args) => {
        const callSid = String(args.callSid ?? "").trim();
        if (!callSid) throw new Error("callSid is required");
        const call = await endTwilioCall(config, callSid);
        return { callSid: call.sid, status: call.status };
      },
    },
    {
      name: "get_call_status",
      description: "Get the current status of a Twilio Voice call by SID.",
      inputSchema: {
        type: "object",
        properties: {
          callSid: { type: "string", description: "Twilio Call SID (CA...)" },
        },
        required: ["callSid"],
      },
      handler: async (args) => {
        const callSid = String(args.callSid ?? "").trim();
        if (!callSid) throw new Error("callSid is required");
        const call = await getTwilioCallStatus(config, callSid);
        return { callSid: call.sid, status: call.status, to: call.to, from: call.from };
      },
    },
  ];
}
