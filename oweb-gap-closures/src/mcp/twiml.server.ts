/**
 * Minimal TwiML helpers for Twilio Voice webhooks.
 */
export function twimlSay(text: string, voice = "Polly.Joanna"): string {
  const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="${voice}">${escaped}</Say></Response>`;
}

export function twimlGatherSay(prompt: string, actionUrl: string): string {
  const escaped = prompt.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Gather input="speech" action="${actionUrl}"><Say>${escaped}</Say></Gather></Response>`;
}

export function twimlHangup(): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>`;
}

export function twimlResponse(xml: string): Response {
  return new Response(xml, { status: 200, headers: { "Content-Type": "text/xml" } });
}
