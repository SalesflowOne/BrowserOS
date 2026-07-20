import { describe, expect, it, vi } from "vitest";

import {
  buildWhatsAppWebhookPath,
  handleWhatsAppTwilioWebhook,
  normalizeWhatsAppInbound,
  sendWhatsAppTwilioMessage,
} from "../src/channels/whatsapp-twilio-channel.server.js";

const config = {
  orgId: "org_test",
  accountSid: "ACtest",
  authToken: "secret",
  fromWhatsApp: "whatsapp:+14155238886",
};

describe("whatsapp-twilio-channel", () => {
  it("normalizes inbound WhatsApp messages", () => {
    const inbound = normalizeWhatsAppInbound({
      From: "whatsapp:+15551234567",
      Body: "hello",
      MessageSid: "SM123",
      ProfileName: "Ada",
    });
    expect(inbound?.channel).toBe("whatsapp");
    expect(inbound?.text).toBe("hello");
    expect(inbound?.displayName).toBe("Ada");
  });

  it("handles webhook and invokes chat runner", async () => {
    const chatRunner = vi.fn().mockResolvedValue({ replyText: "hi back" });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ sid: "SM999" }) });
    vi.stubGlobal("fetch", fetchMock);

    const body = new URLSearchParams({
      AccountSid: "ACtest",
      From: "whatsapp:+15551234567",
      Body: "ping",
      MessageSid: "SM1",
    }).toString();

    const req = new Request("http://localhost/hook", { method: "POST", body });
    const res = await handleWhatsAppTwilioWebhook(req, { config, chatRunner });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("xml");
    await new Promise((r) => setTimeout(r, 50));
    expect(chatRunner).toHaveBeenCalledOnce();

    vi.unstubAllGlobals();
  });

  it("sends outbound WhatsApp via Twilio", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ sid: "SM2" }) });
    vi.stubGlobal("fetch", fetchMock);
    const result = await sendWhatsAppTwilioMessage(config, "+15559998888", "test");
    expect(result.sid).toBe("SM2");
    vi.unstubAllGlobals();
  });

  it("builds webhook path", () => {
    expect(buildWhatsAppWebhookPath("org_1")).toContain("whatsapp");
  });
});
