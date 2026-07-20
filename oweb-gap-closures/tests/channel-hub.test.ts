import { describe, expect, it, vi } from "vitest";

import { handleChannelWebhook } from "../src/channels/channel-hub.server.js";

describe("channel-hub", () => {
  it("routes telegram webhooks", async () => {
    const chatRunner = vi.fn().mockResolvedValue({ replyText: "ok" });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, result: {} }) });
    vi.stubGlobal("fetch", fetchMock);

    const req = new Request("http://localhost/hook", {
      method: "POST",
      headers: { "x-telegram-bot-api-secret-token": "sec" },
      body: JSON.stringify({
        update_id: 1,
        message: {
          message_id: 1,
          chat: { id: 1, type: "private" },
          date: 1,
          text: "hi",
          from: { id: 2, first_name: "A" },
        },
      }),
    });

    const res = await handleChannelWebhook(req, "telegram", "org_1", {
      getConfig: async () => ({
        orgId: "org_1",
        telegram: { orgId: "org_1", botToken: "t", webhookSecret: "sec" },
      }),
      chatRunner,
    });
    expect(res.status).toBe(200);
    vi.unstubAllGlobals();
  });

  it("returns 404 when channel not configured", async () => {
    const res = await handleChannelWebhook(
      new Request("http://localhost", { method: "POST" }),
      "whatsapp",
      "org_1",
      {
        getConfig: async () => ({ orgId: "org_1" }),
        chatRunner: vi.fn(),
      },
    );
    expect(res.status).toBe(404);
  });
});
