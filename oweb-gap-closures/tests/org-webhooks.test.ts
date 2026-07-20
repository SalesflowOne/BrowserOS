import { describe, expect, it, vi } from "vitest";

import {
  buildOrgWebhookUrl,
  handleOrgWebhook,
  signOrgWebhookPayload,
  verifyOrgWebhookSignature,
} from "../src/webhooks/org-webhooks.server.js";

describe("org-webhooks", () => {
  it("signs and verifies payloads", () => {
    const secret = "hook_secret";
    const ts = "1700000000";
    const body = JSON.stringify({ message: "ping" });
    const sig = signOrgWebhookPayload(secret, ts, body);
    expect(verifyOrgWebhookSignature(secret, ts, body, sig)).toBe(true);
    expect(verifyOrgWebhookSignature(secret, ts, body, "sha256=bad")).toBe(false);
  });

  it("builds webhook URL", () => {
    expect(buildOrgWebhookUrl("https://oweb.one", "org_1", "wh_abc")).toBe(
      "https://oweb.one/api/webhooks/org/org_1/wh_abc",
    );
  });

  it("accepts signed webhook and runs chat", async () => {
    const secret = "hook_secret";
    const ts = String(Math.floor(Date.now() / 1000));
    const body = JSON.stringify({ message: "run task", threadKey: "webhook:org_1:jobs" });
    const sig = signOrgWebhookPayload(secret, ts, body);
    const chatRunner = vi.fn().mockResolvedValue({ replyText: "done" });

    const req = new Request("http://localhost/hook", {
      method: "POST",
      headers: {
        "x-oweb-timestamp": ts,
        "x-oweb-signature": sig,
        "content-type": "application/json",
      },
      body,
    });

    const res = await handleOrgWebhook(req, { orgId: "org_1", secret, chatRunner });
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 20));
    expect(chatRunner).toHaveBeenCalledWith(
      expect.objectContaining({ message: "run task", threadKey: "webhook:org_1:jobs" }),
    );
  });

  it("rejects missing signature", async () => {
    const req = new Request("http://localhost/hook", {
      method: "POST",
      body: JSON.stringify({ message: "x" }),
    });
    const res = await handleOrgWebhook(req, {
      orgId: "org_1",
      secret: "s",
      chatRunner: vi.fn(),
    });
    expect(res.status).toBe(401);
  });
});
