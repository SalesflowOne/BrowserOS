import { describe, expect, it, vi } from "vitest";

import {
  buildTelegramWebhookPath,
  handleTelegramWebhook,
  normalizeTelegramInbound,
  shouldProcessTelegramMessage,
  verifyTelegramWebhookSecret,
} from "../src/channels/telegram-channel.server.js";
import type { TelegramChannelConfig } from "../src/channels/channel-types.js";
import type { TelegramMessage } from "../src/channels/telegram-api.js";

const config: TelegramChannelConfig = {
  orgId: "org_test",
  botToken: "123:ABC",
  webhookSecret: "whsec_test",
};

function makeMessage(overrides: Partial<TelegramMessage> = {}): TelegramMessage {
  return {
    message_id: 42,
    chat: { id: 999, type: "private" },
    date: Date.now(),
    text: "hello",
    from: { id: 1, first_name: "Ada" },
    ...overrides,
  };
}

describe("telegram-channel", () => {
  it("verifies webhook secret with timing-safe compare", () => {
    const req = new Request("http://localhost/webhook", {
      headers: { "x-telegram-bot-api-secret-token": "whsec_test" },
    });
    expect(verifyTelegramWebhookSecret(req, "whsec_test")).toBe(true);
    expect(verifyTelegramWebhookSecret(req, "wrong")).toBe(false);
  });

  it("normalizes inbound messages", () => {
    const inbound = normalizeTelegramInbound(makeMessage());
    expect(inbound.channel).toBe("telegram");
    expect(inbound.externalThreadId).toBe("999");
    expect(inbound.text).toBe("hello");
    expect(inbound.displayName).toBe("Ada");
  });

  it("skips bot messages and empty text", () => {
    expect(shouldProcessTelegramMessage(makeMessage({ from: { id: 2, is_bot: true } }), config)).toBe(
      false,
    );
    expect(shouldProcessTelegramMessage(makeMessage({ text: "" }), config)).toBe(false);
  });

  it("handles webhook and invokes chat runner", async () => {
    const chatRunner = vi.fn().mockResolvedValue({ replyText: "pong" });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, result: {} }) });
    vi.stubGlobal("fetch", fetchMock);

    const update = { update_id: 1, message: makeMessage() };
    const req = new Request("http://localhost/webhook", {
      method: "POST",
      headers: {
        "x-telegram-bot-api-secret-token": "whsec_test",
        "content-type": "application/json",
      },
      body: JSON.stringify(update),
    });

    const res = await handleTelegramWebhook(req, { config, chatRunner });
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 50));
    expect(chatRunner).toHaveBeenCalledOnce();

    vi.unstubAllGlobals();
  });

  it("builds webhook path", () => {
    expect(buildTelegramWebhookPath("org_abc")).toBe("/api/channels/telegram/webhook?org=org_abc");
  });
});
