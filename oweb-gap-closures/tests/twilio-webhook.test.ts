import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import { buildTwilioDataToSign, validateTwilioSignature } from "../src/mcp/twilio-webhook-security.server.js";
import { twimlSay } from "../src/mcp/twiml.server.js";

describe("twilio-webhook-security", () => {
  it("builds data to sign", () => {
    const params = new URLSearchParams({ CallSid: "CA1", From: "+1" });
    const data = buildTwilioDataToSign("https://example.com/voice", params);
    expect(data).toContain("CallSid");
    expect(data).toContain("CA1");
  });

  it("validates signature when correct", () => {
    const url = "https://example.com/voice";
    const params = new URLSearchParams({ Foo: "bar" });
    const token = "test_token";
    const sig = createHmac("sha1", token).update(buildTwilioDataToSign(url, params)).digest("base64");
    expect(validateTwilioSignature(token, sig, url, params)).toBe(true);
    expect(validateTwilioSignature(token, "bad", url, params)).toBe(false);
  });
});

describe("twiml", () => {
  it("escapes XML in say", () => {
    const xml = twimlSay("a & b < c");
    expect(xml).toContain("&amp;");
    expect(xml).toContain("&lt;");
  });
});
