import { describe, expect, it, vi } from "vitest";

import { createOwebIntegration } from "../src/integration/api-router.js";
import { createInMemoryChannelConfigStore } from "../src/integration/channel-config-store.js";
import { createEchoChatRunner } from "../src/integration/chat-runner-http.js";
import { createInMemoryMemoryStore } from "../src/mcp/memory-tools.server.js";

describe("oweb integration api-router", () => {
  const store = createInMemoryChannelConfigStore();
  const integration = createOwebIntegration({
    publicBaseUrl: "https://oweb.one",
    channelStore: store,
    getOrgConfig: (id) => store.get(id),
    getWebhookRoute: async () => null,
    chatRunner: createEchoChatRunner(),
    memoryStore: createInMemoryMemoryStore(),
  });

  it("returns channel status", async () => {
    await store.upsertTelegram("org_1", {
      botToken: "t",
      webhookSecret: "s",
    });
    const res = await integration.handle(
      new Request("https://oweb.one/api/channels/status?org=org_1"),
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { telegram: boolean };
    expect(json.telegram).toBe(true);
  });

  it("handles telegram webhook via hub", async () => {
    await store.upsertTelegram("org_1", {
      botToken: "123:ABC",
      webhookSecret: "sec",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, result: {} }) }),
    );

    const res = await integration.handle(
      new Request("https://oweb.one/api/channels/telegram/webhook?org=org_1", {
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
      }),
    );
    expect(res.status).toBe(200);
    vi.unstubAllGlobals();
  });

  it("returns marketplace additions", async () => {
    const res = await integration.handle(
      new Request("https://oweb.one/api/integrations/openclaw-marketplace?existing=slack"),
    );
    const json = (await res.json()) as { missing: string[] };
    expect(json.missing).toContain("telegram");
  });

  it("handles cron endpoint", async () => {
    const res = await integration.handle(
      new Request("https://oweb.one/api/cron/oweb-jobs", { method: "GET" }),
    );
    expect(res.status).toBe(200);
  });
});
