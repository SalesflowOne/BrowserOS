import { describe, expect, it, vi } from "vitest";

import {
  handleRegistryWebhook,
  signOrgWebhookPayload,
} from "../src/webhooks/webhook-registry.server.js";

describe("webhook-registry", () => {
  it("accepts bearer auth", async () => {
    const chatRunner = vi.fn().mockResolvedValue({});
    const secret = "route_secret";
    const body = JSON.stringify({ message: "go" });

    const req = new Request("http://localhost/hook", {
      method: "POST",
      headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
      body,
    });

    const res = await handleRegistryWebhook(req, "org_1", "route_a", {
      getRoute: async () => ({ id: "route_a", orgId: "org_1", secret }),
      chatRunner,
    });

    expect(res.status).toBe(200);
    expect(chatRunner).toHaveBeenCalled();
  });

  it("accepts hmac signature auth", async () => {
    const chatRunner = vi.fn().mockResolvedValue({});
    const secret = "route_secret";
    const ts = String(Math.floor(Date.now() / 1000));
    const body = JSON.stringify({ message: "signed" });
    const sig = signOrgWebhookPayload(secret, ts, body);

    const req = new Request("http://localhost/hook", {
      method: "POST",
      headers: {
        "x-oweb-timestamp": ts,
        "x-oweb-signature": sig,
        "content-type": "application/json",
      },
      body,
    });

    const res = await handleRegistryWebhook(req, "org_1", "route_a", {
      getRoute: async () => ({ id: "route_a", orgId: "org_1", secret }),
      chatRunner,
    });

    expect(res.status).toBe(200);
  });
});
